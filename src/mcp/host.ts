/**
 * McpHost — manages connections to all configured MCP servers.
 *
 * On startup it:
 *  1. Launches each stdio MCP server from mcp.json config
 *  2. Starts the built-in in-process memory server
 *  3. Discovers all tools from every server
 *  4. Exposes them in OpenAI tool format for OpenRouter
 *
 * When the agent calls a tool, callTool() routes it to the right server.
 */

import { Client }               from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport }    from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool }            from '@modelcontextprotocol/sdk/types.js';
import type OpenAI              from 'openai';
import { mcpConfig }            from '../config.js';
import { createMemoryServer }   from './memory-server.js';

interface ConnectedServer {
  name:   string;
  client: Client;
}

export class McpHost {
  private servers:      ConnectedServer[] = [];
  private toolMap:      Map<string, Client> = new Map();  // tool name → owning client
  private _tools:       OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  private _serverNames: string[] = [];

  // ── Initialise ────────────────────────────────────────────────────────────

  async init(onStatus?: (msg: string) => void): Promise<void> {
    // 1. Built-in memory server (in-process, always available)
    await this._connectInProcess('memory', onStatus);

    // 2. User-configured stdio servers
    for (const [name, cfg] of Object.entries(mcpConfig.mcpServers)) {
      await this._connectStdio(name, cfg.command, cfg.args, cfg.env, onStatus);
    }

    // 3. Discover all tools
    await this._discoverTools(onStatus);
  }

  // ── Connection helpers ────────────────────────────────────────────────────

  private async _connectInProcess(name: string, onStatus?: (m: string) => void): Promise<void> {
    try {
      onStatus?.(`Connecting to built-in ${name} server…`);
      const server = createMemoryServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      const client = new Client({ name: 'devassist-host', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      this.servers.push({ name, client });
      this._serverNames.push(name);
      onStatus?.(`✓ ${name} (built-in)`);
    } catch (e) {
      onStatus?.(`✗ ${name}: ${e}`);
    }
  }

  private async _connectStdio(
    name: string,
    command: string,
    args: string[],
    env: Record<string, string> = {},
    onStatus?: (m: string) => void,
  ): Promise<void> {
    try {
      onStatus?.(`Connecting to ${name}…`);
      const transport = new StdioClientTransport({
        command,
        args,
        // Merge process env with server-specific env overrides
        env: { ...process.env, ...env } as Record<string, string>,
      });

      const client = new Client({ name: 'devassist-host', version: '1.0.0' }, { capabilities: {} });
      await client.connect(transport);

      this.servers.push({ name, client });
      this._serverNames.push(name);
      onStatus?.(`✓ ${name}`);
    } catch (e) {
      // Non-fatal: the server might not be installed. Warn and continue.
      onStatus?.(`✗ ${name} (skipped — ${e instanceof Error ? e.message : e})`);
    }
  }

  // ── Tool discovery ────────────────────────────────────────────────────────

  private async _discoverTools(onStatus?: (m: string) => void): Promise<void> {
    const allTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

    for (const { name: serverName, client } of this.servers) {
      try {
        const result = await client.listTools();
        let count = 0;

        for (const tool of result.tools as Tool[]) {
          if (this.toolMap.has(tool.name)) {
            // Tool name collision — prefix with server name
            const prefixed = `${serverName}__${tool.name}`;
            this.toolMap.set(prefixed, client);
            allTools.push(toOpenAiTool(prefixed, tool));
          } else {
            this.toolMap.set(tool.name, client);
            allTools.push(toOpenAiTool(tool.name, tool));
          }
          count++;
        }

        onStatus?.(`  └ ${serverName}: ${count} tools`);
      } catch (e) {
        onStatus?.(`  └ ${serverName}: failed to list tools — ${e}`);
      }
    }

    this._tools = allTools;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get tools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return this._tools;
  }

  get serverNames(): string[] {
    return this._serverNames;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const client = this.toolMap.get(name);
    if (!client) {
      return JSON.stringify({ error: `No MCP server found for tool: ${name}` });
    }

    try {
      const result = await client.callTool({ name, arguments: args });

      // Extract text blocks from MCP result
      if (Array.isArray(result.content)) {
        const parts = result.content
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((c: any) => c.type === 'text')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => c.text as string);

        if (parts.length > 0) return parts.join('\n');
      }

      return JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ error: `Tool "${name}" error: ${e instanceof Error ? e.message : e}` });
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.servers.map(({ client }) => client.close()));
  }
}

// ─── Helper: MCP Tool → OpenAI tool format ────────────────────────────────────

function toOpenAiTool(
  name: string,
  tool: Tool,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name,
      description: tool.description ?? '',
      // MCP inputSchema is already JSON Schema — pass through as-is
      parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    },
  };
}
