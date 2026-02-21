import Anthropic from "@anthropic-ai/sdk";
import * as clickup from "../services/clickup.js";
import * as github from "../services/github.js";
import * as harvest from "../services/harvest.js";
import * as db from "../db/database.js";
import { cfg } from "../utils/config.js";

// ─── Tool Definitions (JSON Schema for Claude) ────────────────────────────────

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  // ── ClickUp Tools ──────────────────────────────────────────────────────────
  {
    name: "clickup_get_task",
    description: "Get details of a specific ClickUp ticket/task by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ClickUp task ID (e.g. 'abc123' or '#abc123')" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "clickup_list_tasks",
    description:
      "List ClickUp tasks/tickets from your configured list. Can filter by status or search query.",
    input_schema: {
      type: "object" as const,
      properties: {
        statuses: {
          type: "array",
          items: { type: "string" },
          description: "Filter by status names, e.g. ['in progress', 'in review']",
        },
        query: { type: "string", description: "Text search within task names" },
        list_id: { type: "string", description: "Override the default list ID" },
      },
      required: [],
    },
  },
  {
    name: "clickup_update_status",
    description: "Update the status of a ClickUp ticket/task.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ClickUp task ID" },
        status: {
          type: "string",
          description:
            "New status (e.g. 'in progress', 'in review', 'ready for dev', 'done')",
        },
      },
      required: ["task_id", "status"],
    },
  },
  {
    name: "clickup_add_comment",
    description: "Add a comment to a ClickUp task.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string" },
        comment: { type: "string", description: "Comment text to add" },
      },
      required: ["task_id", "comment"],
    },
  },

  // ── GitHub Tools ───────────────────────────────────────────────────────────
  {
    name: "github_list_prs",
    description: "List pull requests in a GitHub repository.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string",
          description: "Repository in 'owner/repo' format. Defaults to configured repo.",
        },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "PR state filter",
        },
      },
      required: [],
    },
  },
  {
    name: "github_get_pr",
    description: "Get details of a specific pull request including reviews and status.",
    input_schema: {
      type: "object" as const,
      properties: {
        pr_number: { type: "number", description: "Pull request number" },
        repo: { type: "string", description: "Repository in 'owner/repo' format" },
      },
      required: ["pr_number"],
    },
  },
  {
    name: "github_create_pr",
    description:
      "Create a new pull request. Also automatically links it to any provided ClickUp ticket IDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR description/body (markdown)" },
        head: { type: "string", description: "Source branch name" },
        base: {
          type: "string",
          description: "Target branch (defaults to 'main')",
        },
        draft: { type: "boolean", description: "Create as draft PR" },
        repo: { type: "string", description: "Repository in 'owner/repo' format" },
        ticket_ids: {
          type: "array",
          items: { type: "string" },
          description: "ClickUp ticket IDs to link this PR to",
        },
      },
      required: ["title", "body", "head"],
    },
  },
  {
    name: "github_list_branches",
    description: "List branches in a GitHub repository.",
    input_schema: {
      type: "object" as const,
      properties: {
        repo: { type: "string", description: "Repository in 'owner/repo' format" },
      },
      required: [],
    },
  },
  {
    name: "github_add_pr_comment",
    description: "Add a comment to a pull request.",
    input_schema: {
      type: "object" as const,
      properties: {
        pr_number: { type: "number" },
        comment: { type: "string" },
        repo: { type: "string" },
      },
      required: ["pr_number", "comment"],
    },
  },

  // ── Harvest Tools ──────────────────────────────────────────────────────────
  {
    name: "harvest_get_today",
    description: "Get today's time entries from Harvest.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "harvest_get_week",
    description: "Get this week's time entries from Harvest.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "harvest_log_hours",
    description: "Log hours in Harvest for today or a specific date.",
    input_schema: {
      type: "object" as const,
      properties: {
        hours: { type: "number", description: "Number of hours to log" },
        notes: {
          type: "string",
          description: "Description of work done (will appear in Harvest)",
        },
        spent_date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (defaults to today)",
        },
        project_id: {
          type: "number",
          description: "Override the default Harvest project ID",
        },
        task_id: {
          type: "number",
          description: "Override the default Harvest task ID",
        },
      },
      required: ["hours", "notes"],
    },
  },

  // ── Memory / Link Tools ────────────────────────────────────────────────────
  {
    name: "memory_link_pr_ticket",
    description:
      "Save a relationship between a GitHub PR and a ClickUp ticket in the local database. This enables future queries like 'which tickets are related to this PR?'.",
    input_schema: {
      type: "object" as const,
      properties: {
        pr_number: { type: "number", description: "GitHub PR number" },
        pr_title: { type: "string" },
        pr_url: { type: "string" },
        ticket_id: { type: "string", description: "ClickUp task ID" },
        ticket_title: { type: "string" },
        ticket_url: { type: "string" },
        repo: {
          type: "string",
          description: "Repository in 'owner/repo' format",
        },
        confidence: {
          type: "string",
          enum: ["manual", "auto"],
          description: "'manual' if explicitly told, 'auto' if inferred",
        },
      },
      required: ["pr_number", "pr_title", "pr_url", "ticket_id", "ticket_title", "ticket_url", "repo"],
    },
  },
  {
    name: "memory_get_tickets_for_pr",
    description: "Look up which ClickUp tickets are linked to a specific GitHub PR.",
    input_schema: {
      type: "object" as const,
      properties: {
        pr_number: { type: "number" },
        repo: { type: "string" },
      },
      required: ["pr_number"],
    },
  },
  {
    name: "memory_get_prs_for_ticket",
    description: "Look up which GitHub PRs are linked to a specific ClickUp ticket.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticket_id: { type: "string" },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "memory_search",
    description: "Search the PR-ticket link memory by keyword.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search term to find related tickets/PRs" },
      },
      required: ["query"],
    },
  },

  // ── Code Plan Tool ─────────────────────────────────────────────────────────
  {
    name: "generate_code_plan",
    description:
      "Generate a structured implementation/code plan for a ClickUp ticket. Returns a markdown plan with file changes, approach, and a PR description template.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticket_id: {
          type: "string",
          description: "ClickUp task ID to generate a plan for",
        },
        additional_context: {
          type: "string",
          description: "Any extra context to inform the plan (tech stack, constraints, etc.)",
        },
      },
      required: ["ticket_id"],
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

export type ToolInput = Record<string, unknown>;

export async function executeTool(
  name: string,
  input: ToolInput
): Promise<string> {
  try {
    const result = await _execute(name, input);
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg}`;
  }
}

async function _execute(name: string, input: ToolInput): Promise<unknown> {
  switch (name) {
    // ── ClickUp ──────────────────────────────────────────────────────────────
    case "clickup_get_task": {
      const task = await clickup.getTask(input.task_id as string);
      return formatTask(task);
    }

    case "clickup_list_tasks": {
      const tasks = await clickup.getTasks({
        listId: input.list_id as string | undefined,
        statuses: input.statuses as string[] | undefined,
        query: input.query as string | undefined,
      });
      if (tasks.length === 0) return "No tasks found matching the criteria.";
      return tasks.map(formatTask).join("\n\n---\n\n");
    }

    case "clickup_update_status": {
      const task = await clickup.updateTaskStatus(
        input.task_id as string,
        input.status as string
      );
      return `✅ Updated task "${task.name}" status to "${task.status.status}"`;
    }

    case "clickup_add_comment": {
      await clickup.addTaskComment(input.task_id as string, input.comment as string);
      return `✅ Comment added to task ${input.task_id}`;
    }

    // ── GitHub ────────────────────────────────────────────────────────────────
    case "github_list_prs": {
      const prs = await github.listPRs(
        input.repo as string | undefined,
        (input.state as "open" | "closed" | "all") ?? "open"
      );
      if (prs.length === 0) return "No pull requests found.";
      return prs.map(formatPR).join("\n\n---\n\n");
    }

    case "github_get_pr": {
      const pr = await github.getPR(
        input.pr_number as number,
        input.repo as string | undefined
      );
      const reviews = await github.getPRReviews(
        input.pr_number as number,
        input.repo as string | undefined
      );
      return formatPR(pr) + "\n\n**Reviews:**\n" +
        (reviews.length === 0
          ? "No reviews yet"
          : reviews.map((r) => `- ${r.user?.login}: ${r.state}`).join("\n"));
    }

    case "github_create_pr": {
      const pr = await github.createPR({
        title: input.title as string,
        body: input.body as string,
        head: input.head as string,
        base: input.base as string | undefined,
        draft: input.draft as boolean | undefined,
        repo: input.repo as string | undefined,
      });

      // Auto-link to tickets if provided
      const ticketIds = input.ticket_ids as string[] | undefined;
      if (ticketIds?.length) {
        for (const ticketId of ticketIds) {
          try {
            const task = await clickup.getTask(ticketId);
            const repo = (input.repo as string) ?? `${cfg.github.owner}/${cfg.github.repo}`;
            db.upsertPrTicketLink({
              pr_number: pr.number,
              pr_url: pr.html_url,
              pr_title: pr.title,
              ticket_id: task.id,
              ticket_url: task.url,
              ticket_title: task.name,
              repo,
              confidence: "manual",
            });
          } catch {
            // ignore individual link failures
          }
        }
      }

      return `✅ PR #${pr.number} created: ${pr.html_url}\n\nTitle: ${pr.title}\nBranch: ${pr.head.ref} → ${pr.base.ref}`;
    }

    case "github_list_branches": {
      const branches = await github.listBranches(input.repo as string | undefined);
      return `Branches (${branches.length}):\n` + branches.join("\n");
    }

    case "github_add_pr_comment": {
      await github.addPRComment(
        input.pr_number as number,
        input.comment as string,
        input.repo as string | undefined
      );
      return `✅ Comment added to PR #${input.pr_number}`;
    }

    // ── Harvest ───────────────────────────────────────────────────────────────
    case "harvest_get_today": {
      const entries = await harvest.getTodayEntries();
      const total = harvest.sumHours(entries);
      if (entries.length === 0) return "No time entries for today.";
      return (
        `**Today's time (${total.toFixed(2)}h total):**\n` +
        entries.map((e) => `- ${e.hours}h — ${e.notes ?? "(no notes)"} [${e.project.name}]`).join("\n")
      );
    }

    case "harvest_get_week": {
      const entries = await harvest.getWeekEntries();
      const total = harvest.sumHours(entries);
      if (entries.length === 0) return "No time entries this week.";
      return (
        `**This week (${total.toFixed(2)}h total):**\n` +
        entries.map((e) => `- ${e.spent_date} ${e.hours}h — ${e.notes ?? "(no notes)"}`).join("\n")
      );
    }

    case "harvest_log_hours": {
      const entry = await harvest.logTime({
        hours: input.hours as number,
        notes: input.notes as string,
        spentDate: input.spent_date as string | undefined,
        projectId: input.project_id as number | undefined,
        taskId: input.task_id as number | undefined,
      });
      return `✅ Logged ${entry.hours}h in Harvest (entry #${entry.id})\nNotes: ${entry.notes}`;
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    case "memory_link_pr_ticket": {
      db.upsertPrTicketLink({
        pr_number: input.pr_number as number,
        pr_title: input.pr_title as string,
        pr_url: input.pr_url as string,
        ticket_id: input.ticket_id as string,
        ticket_title: input.ticket_title as string,
        ticket_url: input.ticket_url as string,
        repo: (input.repo as string) ?? `${cfg.github.owner}/${cfg.github.repo}`,
        confidence: (input.confidence as string) ?? "manual",
      });
      return `✅ Linked PR #${input.pr_number} ↔ ticket ${input.ticket_id} saved to memory`;
    }

    case "memory_get_tickets_for_pr": {
      const repo = (input.repo as string) ?? `${cfg.github.owner}/${cfg.github.repo}`;
      const links = db.getTicketsForPr(input.pr_number as number, repo);
      if (links.length === 0) return `No tickets linked to PR #${input.pr_number}`;
      return links.map((l) => `- ${l.ticket_id}: ${l.ticket_title} (${l.ticket_url})`).join("\n");
    }

    case "memory_get_prs_for_ticket": {
      const links = db.getPrsForTicket(input.ticket_id as string);
      if (links.length === 0) return `No PRs linked to ticket ${input.ticket_id}`;
      return links.map((l) => `- PR #${l.pr_number}: ${l.pr_title} (${l.pr_url})`).join("\n");
    }

    case "memory_search": {
      const links = db.searchLinks(input.query as string);
      if (links.length === 0) return "No matching PR-ticket links found.";
      return links.map((l) =>
        `PR #${l.pr_number} (${l.repo}): "${l.pr_title}" ↔ Ticket ${l.ticket_id}: "${l.ticket_title}"`
      ).join("\n");
    }

    case "generate_code_plan": {
      const task = await clickup.getTask(input.ticket_id as string);
      // The plan itself is generated by Claude in conversation — we just
      // return the raw ticket data so Claude can reason over it.
      return JSON.stringify({
        ticket: formatTask(task),
        additional_context: input.additional_context ?? "",
        instruction:
          "Use the ticket details above to generate a detailed implementation plan with: " +
          "1) Summary, 2) Files to change, 3) Step-by-step approach, 4) PR description template, " +
          "5) Suggested branch name.",
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatTask(task: clickup.CUTask): string {
  return [
    `**[${task.id}] ${task.name}**`,
    `Status: ${task.status.status}`,
    `Priority: ${task.priority?.priority ?? "none"}`,
    `Assignees: ${task.assignees.map((a) => a.username).join(", ") || "none"}`,
    `Due: ${task.due_date ? new Date(parseInt(task.due_date)).toDateString() : "none"}`,
    `URL: ${task.url}`,
    task.description ? `\nDescription: ${task.description.slice(0, 500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPR(pr: github.GHPullRequest): string {
  return [
    `**PR #${pr.number}: ${pr.title}**`,
    `State: ${pr.state}${pr.draft ? " (draft)" : ""}`,
    `Branch: ${pr.head.ref} → ${pr.base.ref}`,
    `Author: ${pr.user?.login ?? "unknown"}`,
    `Labels: ${pr.labels.map((l) => l.name).join(", ") || "none"}`,
    `Reviewers: ${pr.requested_reviewers.map((r) => r.login).join(", ") || "none"}`,
    `URL: ${pr.html_url}`,
    pr.body ? `\nDescription: ${pr.body.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
