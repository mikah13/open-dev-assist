import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}. See .env.example`);
  return val;
}

// ─── MCP config ──────────────────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

function loadMcpConfig(): McpConfig {
  const candidates = [
    process.env['DEVASSIST_MCP_CONFIG'],
    join(homedir(), '.config', 'devassist', 'mcp.json'),
    join(process.cwd(), '.devassist-mcp.json'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        return JSON.parse(raw) as McpConfig;
      } catch {
        // ignore malformed files, try next
      }
    }
  }

  // No config found — return empty (built-in memory server still works)
  return { mcpServers: {} };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const mcpConfig = loadMcpConfig();

export const config = {
  openrouter: {
    apiKey:   required('OPENROUTER_API_KEY'),
    model:    process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-opus-4-6',
    siteName: 'open-dev-assist',
    baseUrl:  'https://openrouter.ai/api/v1',
  },
  db: {
    path: process.env['DB_PATH'] ?? './data/devassist.db',
  },
};
