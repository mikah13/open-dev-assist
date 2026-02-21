import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "../utils/config.js";
import { TOOL_DEFINITIONS, executeTool, ToolInput } from "../tools/index.js";
import { saveMessage, getRecentHistory } from "../db/database.js";

const client = new Anthropic({ apiKey: cfg.anthropic.apiKey });

const SYSTEM_PROMPT = `You are DevAssist, a personal AI workspace for software developers.
You have access to the user's ClickUp (project management), GitHub (PRs, branches, code), and Harvest (time tracking).

Your capabilities:
- Query and update ClickUp tickets
- List, create, and review GitHub PRs
- Log and review time in Harvest
- Remember which PRs are linked to which tickets (persistent SQLite memory)
- Generate code plans from tickets
- Sync ticket statuses based on PR states

Guidelines:
- Be concise and developer-friendly in responses
- When asked about PRs related to a ticket (or vice versa), ALWAYS check the memory first with memory_get_*
- When creating a PR, automatically link it to mentioned ticket IDs
- If you detect a PR title/branch that looks like it references a ticket ID (e.g. "CU-abc123" or "feat/abc123-..."), suggest linking them
- For end-of-day summaries, look at both today's ClickUp tasks and Harvest entries
- Format output in clean markdown when rendering lists or plans
- When updating ticket status based on PR state, always confirm with the user first unless explicitly told to auto-sync`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  type: "text" | "tool_start" | "tool_end" | "done";
  text?: string;
  toolName?: string;
  toolResult?: string;
}

// ─── Main Chat Function ───────────────────────────────────────────────────────

export async function* chat(
  userMessage: string,
  onChunk: (chunk: StreamChunk) => void
): AsyncGenerator<void> {
  // Save user message
  saveMessage("user", userMessage);

  // Load history and build messages array
  const history = getRecentHistory(40);
  const messages: Anthropic.MessageParam[] = history.map((h) => ({
    role: h.role,
    content: h.content,
  }));

  // Agentic loop: keep going until Claude stops calling tools
  let continueLoop = true;

  while (continueLoop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamParams: any = {
      model: "claude-opus-4-6",
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
    };
    const stream = await client.messages.stream(streamParams);

    let assistantText = "";
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    // Stream events to caller
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          onChunk({ type: "tool_start", toolName: event.content_block.name });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          assistantText += event.delta.text;
          onChunk({ type: "text", text: event.delta.text });
        }
      }
    }

    const finalMsg = await stream.finalMessage();

    // Collect tool use blocks
    for (const block of finalMsg.content) {
      if (block.type === "tool_use") {
        toolUseBlocks.push(block);
      }
    }

    // Append assistant turn to history
    messages.push({ role: "assistant", content: finalMsg.content });

    if (finalMsg.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      // Done — save assistant response
      if (assistantText) {
        saveMessage("assistant", assistantText);
      }
      continueLoop = false;
    } else {
      // Execute tools and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        onChunk({ type: "tool_start", toolName: toolBlock.name });
        const result = await executeTool(toolBlock.name, toolBlock.input as ToolInput);
        onChunk({ type: "tool_end", toolName: toolBlock.name, toolResult: result });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  onChunk({ type: "done" });
}

// ─── Non-streaming for background tasks ──────────────────────────────────────

export async function ask(prompt: string): Promise<string> {
  let result = "";
  const chunks: StreamChunk[] = [];

  for await (const _ of chat(prompt, (chunk) => chunks.push(chunk))) {
    // drain
  }

  result = chunks
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");

  return result;
}
