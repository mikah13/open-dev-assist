/**
 * End-of-day summary: pulls today's ClickUp activity and Harvest time,
 * generates an AI summary, and optionally logs remaining hours to Harvest.
 */
import Anthropic from "@anthropic-ai/sdk";
import * as clickup from "../services/clickup.js";
import * as harvest from "../services/harvest.js";
import * as db from "../db/database.js";
import { cfg } from "../utils/config.js";
import { TOOL_DEFINITIONS, executeTool, ToolInput } from "../tools/index.js";

const client = new Anthropic({ apiKey: cfg.anthropic.apiKey });

export interface EODResult {
  date: string;
  summary: string;
  hoursLogged: number;
  harvestEntryId?: string;
}

export async function generateEODSummary(opts: {
  autoLogHours?: boolean;
  targetHours?: number;
}): Promise<EODResult> {
  const today = new Date().toISOString().slice(0, 10);

  // Collect data in parallel
  const [tasks, timeEntries] = await Promise.all([
    clickup.getMyTasks().catch(() => []),
    harvest.getTodayEntries().catch(() => []),
  ]);

  const hoursToday = harvest.sumHours(timeEntries);
  const targetHours = opts.targetHours ?? cfg.app.defaultHoursPerDay;

  const context = `
Today's date: ${today}

## My ClickUp Tasks (current state):
${tasks.length === 0 ? "No tasks found" : tasks.map((t) =>
  `- [${t.status.status.toUpperCase()}] ${t.id}: ${t.name}`
).join("\n")}

## Harvest Time Entries Today:
${timeEntries.length === 0 ? "No time logged yet today" : timeEntries.map((e) =>
  `- ${e.hours}h: ${e.notes ?? "(no notes)"} [${e.project.name}]`
).join("\n")}
Total: ${hoursToday.toFixed(2)}h / ${targetHours}h target

## PR-Ticket Links (for context):
${db.getAllLinks().slice(0, 10).map((l) =>
  `- PR #${l.pr_number} ↔ ${l.ticket_id}: ${l.ticket_title} [${l.repo}]`
).join("\n") || "None stored yet"}
`.trim();

  const prompt = `Generate an end-of-day summary for a software developer based on the data below.

Format the summary as:
## End of Day — ${today}

### ✅ Completed / In Progress
(list tasks that are done or in progress)

### ⏳ Not Started / Blocked
(list tasks not started or blocked)

### ⏱️ Time Summary
(summarize Harvest entries and total hours)

### 📝 Notes
(any observations, blockers, or things to carry over tomorrow)

Keep it concise, developer-friendly, and actionable.

---
${context}`;

  // Generate summary with Claude (non-tool call, just text)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createParams: any = {
    model: "claude-opus-4-6",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: prompt }],
  };
  const summaryRes = await client.messages.create(createParams);

  const summary = summaryRes.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("");

  // Optionally log remaining hours
  let harvestEntryId: string | undefined;
  if (opts.autoLogHours && hoursToday < targetHours) {
    const remaining = Math.round((targetHours - hoursToday) * 100) / 100;
    if (remaining > 0) {
      const shortSummary = summary.split("\n").slice(2, 8).join(" ").slice(0, 200);
      try {
        const entry = await harvest.logTime({
          hours: remaining,
          notes: `EOD auto-log: ${shortSummary}`,
          spentDate: today,
        });
        harvestEntryId = String(entry.id);
      } catch {
        // non-fatal
      }
    }
  }

  // Save to DB
  db.saveDailySummary(today, summary, hoursToday, harvestEntryId);

  return { date: today, summary, hoursLogged: hoursToday, harvestEntryId };
}
