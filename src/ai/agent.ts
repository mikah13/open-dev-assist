/**
 * AI agent — connects OpenRouter to the MCP tool layer.
 *
 * Flow per user message:
 *  1. Append user message to conversation history
 *  2. Call OpenRouter (streaming) with all discovered MCP tools
 *  3. If the model returns tool_calls → execute via McpHost → append results → repeat
 *  4. When stop_reason is "end_turn" / no tool_calls → yield final text
 *
 * The caller receives streamed text chunks and tool-use status updates via callbacks.
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import type { McpHost } from '../mcp/host.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface AgentCallbacks {
  onToken:      (token: string) => void;   // stream text chunks to UI
  onToolStart:  (name: string) => void;    // show "calling tool…"
  onToolEnd:    (name: string, result: string) => void;
  onError:      (msg: string) => void;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a personal dev workspace assistant for a software developer.

You have access to tools provided by connected MCP servers. These may include integrations \
for GitHub (PRs, branches, repos), ClickUp (tickets, statuses), Harvest (time tracking), \
filesystem access, and more — depending on what the user has configured.

You also have access to a built-in memory server (tool names starting with "memory_") that \
lets you persist and recall relationships between GitHub PRs and ClickUp tickets, configure \
automatic ticket-status sync rules, and save named project contexts.

Guidelines:
- Be concise and action-oriented. Prefer showing results to explaining what you're about to do.
- When the user mentions a project, repo, or ticket you haven't seen before, use your tools \
  to discover context dynamically — never assume fixed IDs.
- When you discover a PR↔ticket association, always call memory_link_pr_to_ticket to persist it.
- When asked to sync a PR to its tickets: use your GitHub tools to get the PR state and reviews, \
  call memory_get_sync_rule_for_event to check if a rule applies, then call the ClickUp tool \
  to update the ticket status.
- When asked for an end-of-day summary: gather today's Harvest entries, linked PRs updated \
  today, and open/closed ClickUp tasks, then offer to log any unlogged hours.
- For slash commands typed by the user (/eod, /sync, /rules, /projects) — interpret and act.
`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class Agent {
  private client: OpenAI;
  private history: ChatMessage[] = [];
  private host: McpHost;

  constructor(host: McpHost) {
    this.host = host;
    this.client = new OpenAI({
      apiKey:  config.openrouter.apiKey,
      baseURL: config.openrouter.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/open-dev-assist',
        'X-Title':      config.openrouter.siteName,
      },
    });
  }

  get model(): string {
    return config.openrouter.model;
  }

  clearHistory(): void {
    this.history = [];
  }

  async chat(userMessage: string, callbacks: AgentCallbacks): Promise<void> {
    this.history.push({ role: 'user', content: userMessage });

    const tools = this.host.tools;

    // Agentic loop — run until the model stops calling tools
    for (let turn = 0; turn < 20; turn++) {
      let assistantText = '';
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

      try {
        const stream = await this.client.chat.completions.create({
          model:      config.openrouter.model,
          messages:   [{ role: 'system', content: SYSTEM_PROMPT }, ...this.history],
          tools:      tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          stream:     true,
          max_tokens: 4096,
        });

        // Stream tokens and collect tool_calls
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            assistantText += delta.content;
            callbacks.onToken(delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  id:       tc.id ?? `tc_${idx}`,
                  type:     'function',
                  function: { name: tc.function?.name ?? '', arguments: '' },
                };
              }
              if (tc.function?.name)      toolCalls[idx]!.function.name      += tc.function.name;
              if (tc.function?.arguments) toolCalls[idx]!.function.arguments += tc.function.arguments;
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        callbacks.onError(msg);
        // Remove the user message we added (avoid corrupt history)
        this.history.pop();
        return;
      }

      // Append assistant turn to history
      const assistantMsg: ChatMessage = {
        role:    'assistant',
        content: assistantText || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
      this.history.push(assistantMsg);

      // No tool calls → we're done
      if (toolCalls.length === 0) break;

      // Execute each tool call via McpHost and collect results
      const toolResults: ChatMessage[] = [];
      for (const tc of toolCalls) {
        const name = tc.function.name;
        callbacks.onToolStart(name);

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          // leave empty if arguments are malformed
        }

        const result = await this.host.callTool(name, parsedArgs);
        callbacks.onToolEnd(name, result);

        toolResults.push({
          role:         'tool',
          tool_call_id: tc.id,
          content:      result,
        });
      }

      this.history.push(...toolResults);
    }
  }
}
