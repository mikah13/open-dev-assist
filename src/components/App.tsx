import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { MessageList, Message } from "./MessageList.js";
import { StatusBar } from "./StatusBar.js";
import { Header } from "./Header.js";
import { chat, StreamChunk } from "../services/claude.js";
import { generateEODSummary } from "../utils/eod-summary.js";
import { syncPRsToTickets, autoLinkFromBranchNames } from "../utils/sync.js";
import { getRecentHistory } from "../db/database.js";
import { cfg } from "../utils/config.js";
import { getTodayEntries, sumHours } from "../services/harvest.js";

function uid(): string {
  return Math.random().toString(36).slice(2);
}

export function App() {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 100;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeToolName, setActiveToolName] = useState<string | undefined>();
  const [hoursToday, setHoursToday] = useState<number | undefined>();
  const assistantMsgIdRef = useRef<string | null>(null);

  // Load conversation history on mount
  useEffect(() => {
    const history = getRecentHistory(30);
    if (history.length > 0) {
      setMessages(
        history.map((h) => ({
          id: uid(),
          role: h.role,
          content: h.content,
          timestamp: new Date(h.created_at),
        }))
      );
    } else {
      setMessages([
        {
          id: uid(),
          role: "system",
          content: "👋 Welcome to DevAssist. Ask me about your tickets, PRs, or time tracking.",
          timestamp: new Date(),
        },
      ]);
    }

    // Load today's hours
    getTodayEntries()
      .then((entries) => setHoursToday(sumHours(entries)))
      .catch(() => {});
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateLastAssistantMessage = useCallback(
    (updater: (msg: Message) => Message) => {
      setMessages((prev) => {
        if (!assistantMsgIdRef.current) return prev;
        return prev.map((m) =>
          m.id === assistantMsgIdRef.current ? updater(m) : m
        );
      });
    },
    []
  );

  const handleSpecialCommands = useCallback(
    async (cmd: string): Promise<boolean> => {
      if (cmd === "/eod" || cmd === "/end-of-day") {
        setIsLoading(true);
        setActiveToolName("generating EOD summary…");
        addMessage({
          id: uid(),
          role: "system",
          content: "📊 Generating end-of-day summary and logging hours to Harvest…",
          timestamp: new Date(),
        });
        try {
          const result = await generateEODSummary({ autoLogHours: true });
          addMessage({
            id: uid(),
            role: "assistant",
            content: result.summary + (result.harvestEntryId
              ? `\n\n✅ Hours auto-logged to Harvest (entry #${result.harvestEntryId})`
              : ""),
            timestamp: new Date(),
          });
        } catch (err) {
          addMessage({
            id: uid(),
            role: "system",
            content: `❌ EOD summary failed: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date(),
          });
        }
        setIsLoading(false);
        setActiveToolName(undefined);
        return true;
      }

      if (cmd === "/sync") {
        setIsLoading(true);
        setActiveToolName("syncing tickets with PRs…");
        addMessage({
          id: uid(),
          role: "system",
          content: "🔄 Syncing PR statuses to ClickUp tickets…",
          timestamp: new Date(),
        });
        try {
          // Auto-link first
          const linked = await autoLinkFromBranchNames({});
          const results = await syncPRsToTickets({ dryRun: false });

          const updated = results.filter((r) => r.updated && !r.error);
          const errors = results.filter((r) => r.error);

          let summary = `**Sync complete.**\n`;
          if (linked > 0) summary += `Auto-linked ${linked} new PR(s) to tickets.\n`;
          if (updated.length === 0 && linked === 0) {
            summary += "No ticket updates needed.";
          } else {
            summary += updated
              .map((r) => `- PR #${r.prNumber} → **${r.ticketId}** status → "${r.newStatus}"`)
              .join("\n");
          }
          if (errors.length > 0) {
            summary += "\n\n⚠️ Errors:\n" + errors.map((r) => `- ${r.error}`).join("\n");
          }

          addMessage({
            id: uid(),
            role: "assistant",
            content: summary,
            timestamp: new Date(),
          });
        } catch (err) {
          addMessage({
            id: uid(),
            role: "system",
            content: `❌ Sync failed: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date(),
          });
        }
        setIsLoading(false);
        setActiveToolName(undefined);
        return true;
      }

      if (cmd === "/help") {
        addMessage({
          id: uid(),
          role: "assistant",
          content: `## DevAssist Commands

### Slash Commands
- \`/eod\` — Generate end-of-day summary and auto-log hours to Harvest
- \`/sync\` — Sync PR statuses to ClickUp ticket statuses
- \`/help\` — Show this help

### Natural Language Examples
- "What tickets am I working on?"
- "Show me open PRs in my repo"
- "What's linked to ticket CU-abc123?"
- "Create a PR for branch feat/my-feature for ticket CU-abc123"
- "Generate a code plan for ticket CU-abc123"
- "How many hours have I logged today?"
- "Log 2 hours for working on the auth feature"
- "Link PR #42 to ticket CU-abc123"`,
          timestamp: new Date(),
        });
        return true;
      }

      return false;
    },
    [addMessage]
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isLoading) return;

      setInput("");

      // Handle slash commands
      if (trimmed.startsWith("/")) {
        const handled = await handleSpecialCommands(trimmed);
        if (handled) return;
      }

      // Add user message
      addMessage({
        id: uid(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      });

      // Create assistant placeholder
      const assistantId = uid();
      assistantMsgIdRef.current = assistantId;
      addMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
        timestamp: new Date(),
      });

      setIsLoading(true);

      try {
        for await (const _ of chat(trimmed, (chunk: StreamChunk) => {
          switch (chunk.type) {
            case "text":
              updateLastAssistantMessage((msg) => ({
                ...msg,
                content: msg.content + (chunk.text ?? ""),
              }));
              break;

            case "tool_start":
              setActiveToolName(chunk.toolName);
              updateLastAssistantMessage((msg) => ({
                ...msg,
                toolCalls: [
                  ...(msg.toolCalls ?? []),
                  { name: chunk.toolName! },
                ],
              }));
              break;

            case "tool_end":
              setActiveToolName(undefined);
              updateLastAssistantMessage((msg) => {
                const calls = [...(msg.toolCalls ?? [])];
                const lastIdx = calls.length - 1;
                if (lastIdx >= 0 && calls[lastIdx].name === chunk.toolName) {
                  calls[lastIdx] = { ...calls[lastIdx], result: chunk.toolResult };
                }
                return { ...msg, toolCalls: calls };
              });
              // Refresh hours after Harvest operations
              if (chunk.toolName?.startsWith("harvest_")) {
                getTodayEntries()
                  .then((entries) => setHoursToday(sumHours(entries)))
                  .catch(() => {});
              }
              break;

            case "done":
              setIsLoading(false);
              setActiveToolName(undefined);
              break;
          }
        })) {
          // drain async generator
        }
      } catch (err) {
        updateLastAssistantMessage((msg) => ({
          ...msg,
          content:
            msg.content ||
            `❌ Error: ${err instanceof Error ? err.message : String(err)}`,
        }));
        setIsLoading(false);
        setActiveToolName(undefined);
      }
    },
    [isLoading, addMessage, updateLastAssistantMessage, handleSpecialCommands]
  );

  useInput((_, key) => {
    // Ctrl+L to clear screen (messages only)
    if (key.ctrl && _.toLowerCase() === "l") {
      setMessages([]);
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Header terminalWidth={terminalWidth} />

      <Box flexDirection="column" flexGrow={1} overflowY="hidden" padding={1}>
        <MessageList messages={messages} terminalWidth={terminalWidth} />
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <StatusBar
          isLoading={isLoading}
          activeToolName={activeToolName}
          terminalWidth={terminalWidth}
          hoursToday={hoursToday}
          targetHours={cfg.app.defaultHoursPerDay}
        />
        <Box marginTop={1}>
          <Text color="green" bold>
            ›{" "}
          </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Ask anything… (/help for commands)"
          />
        </Box>
      </Box>
    </Box>
  );
}
