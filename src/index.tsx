#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { generateEODSummary } from "./utils/eod-summary.js";
import { syncPRsToTickets, autoLinkFromBranchNames } from "./utils/sync.js";

const args = process.argv.slice(2);

async function main() {
  // CLI mode: --eod flag
  if (args.includes("--eod")) {
    console.log("📊 Generating end-of-day summary…\n");
    try {
      const result = await generateEODSummary({ autoLogHours: true });
      console.log(result.summary);
      if (result.harvestEntryId) {
        console.log(`\n✅ Hours auto-logged to Harvest (entry #${result.harvestEntryId})`);
      }
      console.log(`\nTotal hours today: ${result.hoursLogged.toFixed(2)}h`);
    } catch (err) {
      console.error("❌ EOD summary failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
    process.exit(0);
  }

  // CLI mode: --sync flag
  if (args.includes("--sync")) {
    const dryRun = args.includes("--dry-run");
    console.log(`🔄 Syncing PR statuses to tickets${dryRun ? " (dry run)" : ""}…\n`);
    try {
      const linked = await autoLinkFromBranchNames({});
      if (linked > 0) {
        console.log(`Auto-linked ${linked} PR(s) to tickets based on branch names.`);
      }

      const results = await syncPRsToTickets({ dryRun });
      const updated = results.filter((r) => r.updated && !r.error);
      const errors = results.filter((r) => r.error);

      if (updated.length === 0 && linked === 0) {
        console.log("No updates needed.");
      } else {
        updated.forEach((r) => {
          console.log(
            `${dryRun ? "[DRY RUN] " : ""}PR #${r.prNumber} (${r.event}) → Ticket ${r.ticketId}: ${r.oldStatus} → ${r.newStatus}`
          );
        });
      }

      if (errors.length > 0) {
        console.error("\nErrors:");
        errors.forEach((r) => console.error(`  - PR #${r.prNumber} / ${r.ticketId}: ${r.error}`));
      }
    } catch (err) {
      console.error("❌ Sync failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
    process.exit(0);
  }

  // TUI mode (default)
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
