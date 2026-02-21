/**
 * PR → Ticket sync engine.
 *
 * Rules:
 *  PR opened       → ticket status "in review"
 *  PR approved     → ticket status "ready for dev" (ready for QA/deploy)
 *  PR merged       → ticket status "done" (or configurable)
 *  PR closed (no merge) → ticket status back to "in progress"
 */
import * as github from "../services/github.js";
import * as clickup from "../services/clickup.js";
import * as db from "../db/database.js";
import { cfg } from "../utils/config.js";

export interface SyncResult {
  prNumber: number;
  prTitle: string;
  ticketId: string;
  ticketTitle: string;
  event: string;
  oldStatus: string | null;
  newStatus: string;
  updated: boolean;
  error?: string;
}

const STATUS_MAP: Record<string, string> = {
  pr_opened: "in review",
  pr_approved: "ready for dev",
  pr_merged: "done",
  pr_closed: "in progress",
};

export async function syncPRsToTickets(opts: {
  repo?: string;
  dryRun?: boolean;
}): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const repo = opts.repo ?? `${cfg.github.owner}/${cfg.github.repo}`;

  // Get all open and recently closed PRs
  const [openPRs, closedPRs] = await Promise.all([
    github.listPRs(repo, "open"),
    github.listPRs(repo, "closed"),
  ]);

  const allPRs = [...openPRs, ...closedPRs.slice(0, 20)];

  for (const pr of allPRs) {
    const links = db.getTicketsForPr(pr.number, repo);
    if (links.length === 0) continue;

    // Determine event type
    let event: string;
    if (pr.state === "closed" && pr.merged_at) {
      event = "pr_merged";
    } else if (pr.state === "closed") {
      event = "pr_closed";
    } else {
      // Check reviews for approval
      const reviews = await github.getPRReviews(pr.number, repo);
      const approved = reviews.some((r) => r.state === "APPROVED");
      event = approved ? "pr_approved" : "pr_opened";
    }

    const newStatus = STATUS_MAP[event];

    for (const link of links) {
      const result: SyncResult = {
        prNumber: pr.number,
        prTitle: pr.title,
        ticketId: link.ticket_id,
        ticketTitle: link.ticket_title,
        event,
        oldStatus: null,
        newStatus,
        updated: false,
      };

      try {
        const task = await clickup.getTask(link.ticket_id);
        result.oldStatus = task.status.status;

        // Skip if already in the target status or a "later" status
        if (shouldSkipUpdate(task.status.status, newStatus)) {
          results.push(result);
          continue;
        }

        if (!opts.dryRun) {
          await clickup.updateTaskStatus(link.ticket_id, newStatus);
          db.logSyncEvent(event, pr.number, link.ticket_id, result.oldStatus, newStatus);
          result.updated = true;
        } else {
          result.updated = true; // would have updated
        }
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
      }

      results.push(result);
    }
  }

  return results;
}

// Don't downgrade a ticket status (e.g. don't move "done" back to "in review")
const STATUS_ORDER = ["open", "in progress", "in review", "ready for dev", "done"];

function shouldSkipUpdate(currentStatus: string, newStatus: string): boolean {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus.toLowerCase());
  const newIdx = STATUS_ORDER.indexOf(newStatus.toLowerCase());
  // Only skip if current is already further along
  return currentIdx > newIdx;
}

// Auto-link PRs to tickets based on branch name or PR title patterns
export async function autoLinkFromBranchNames(opts: {
  repo?: string;
}): Promise<number> {
  const repo = opts.repo ?? `${cfg.github.owner}/${cfg.github.repo}`;
  const prs = await github.listPRs(repo, "open");
  let linked = 0;

  // Patterns: CU-taskid, feat/taskid-..., fix/taskid-..., etc.
  const patterns = [
    /\bCU-([a-z0-9]+)\b/gi,
    /\b([a-z0-9]{7,})\b.*(?:feat|fix|chore|refactor)/gi,
  ];

  for (const pr of prs) {
    const existing = db.getTicketsForPr(pr.number, repo);
    if (existing.length > 0) continue; // already linked

    const text = `${pr.title} ${pr.head.ref} ${pr.body ?? ""}`;

    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const ticketId = match[1];
        try {
          const task = await clickup.getTask(ticketId);
          db.upsertPrTicketLink({
            pr_number: pr.number,
            pr_url: pr.html_url,
            pr_title: pr.title,
            ticket_id: task.id,
            ticket_url: task.url,
            ticket_title: task.name,
            repo,
            confidence: "auto",
          });
          linked++;
        } catch {
          // ticket not found, ignore
        }
      }
    }
  }

  return linked;
}
