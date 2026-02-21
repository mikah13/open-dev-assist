/**
 * Built-in MCP server for app-specific SQLite memory.
 * Runs in-process via InMemoryTransport — no extra process needed.
 *
 * Exposes tools for:
 *  - PR ↔ ClickUp ticket links
 *  - PR event → ClickUp status sync rules (user-configurable)
 *  - Named project contexts (GitHub repos + ClickUp lists + Harvest projects)
 */

import { Server }                from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport }  from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { links, syncRules, projects } from '../db/index.js';

// ─── Tool catalogue ──────────────────────────────────────────────────────────

const TOOLS = [
  // PR ↔ Ticket links
  {
    name: 'memory_link_pr_to_ticket',
    description: 'Persist a relationship between a GitHub PR and a ClickUp ticket. Call this whenever a PR↔ticket association is confirmed so you can recall it later.',
    inputSchema: {
      type: 'object',
      properties: {
        pr_url:         { type: 'string', description: 'Full GitHub PR URL' },
        pr_number:      { type: 'number', description: 'PR number' },
        repo_full_name: { type: 'string', description: '"owner/repo"' },
        pr_title:       { type: 'string', description: 'PR title' },
        ticket_id:      { type: 'string', description: 'ClickUp task ID' },
        ticket_url:     { type: 'string', description: 'ClickUp task URL' },
        ticket_title:   { type: 'string', description: 'ClickUp task name' },
        project_hint:   { type: 'string', description: 'Inferred project name (optional)' },
      },
      required: ['pr_url', 'pr_number', 'repo_full_name', 'pr_title', 'ticket_id'],
    },
  },
  {
    name: 'memory_get_prs_for_ticket',
    description: 'Retrieve all GitHub PRs previously linked to a ClickUp ticket ID.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'memory_get_tickets_for_pr',
    description: 'Retrieve all ClickUp tickets previously linked to a GitHub PR URL.',
    inputSchema: {
      type: 'object',
      properties: {
        pr_url: { type: 'string' },
      },
      required: ['pr_url'],
    },
  },
  {
    name: 'memory_list_all_links',
    description: 'List all stored PR↔ticket links (most recent first, up to 100).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },

  // Sync rules
  {
    name: 'memory_list_sync_rules',
    description: 'List all configured PR event → ClickUp status sync rules.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'memory_set_sync_rule',
    description:
      'Create or update a sync rule: when a linked PR reaches a certain state, automatically move its ClickUp ticket to the given status.\n\n' +
      'PR events: opened | approved | merged | closed | changes_requested | ready_for_review | draft\n\n' +
      'Example: pr_event="merged", clickup_status="Done"',
    inputSchema: {
      type: 'object',
      properties: {
        pr_event: {
          type: 'string',
          enum: ['opened', 'approved', 'merged', 'closed', 'changes_requested', 'ready_for_review', 'draft'],
        },
        clickup_status: { type: 'string', description: 'Target ClickUp status — must match exactly (e.g. "In Review")' },
        description:    { type: 'string', description: 'Optional note about this rule' },
      },
      required: ['pr_event', 'clickup_status'],
    },
  },
  {
    name: 'memory_delete_sync_rule',
    description: 'Remove the sync rule for a specific PR event.',
    inputSchema: {
      type: 'object',
      properties: {
        pr_event: { type: 'string' },
      },
      required: ['pr_event'],
    },
  },
  {
    name: 'memory_get_sync_rule_for_event',
    description: 'Get the sync rule (if any) for a specific PR event. Use this when a PR state changes to determine whether to update linked tickets.',
    inputSchema: {
      type: 'object',
      properties: {
        pr_event: { type: 'string' },
      },
      required: ['pr_event'],
    },
  },

  // Project contexts
  {
    name: 'memory_save_project_context',
    description:
      'Save a named project context that maps a project name to its GitHub repos, ClickUp list IDs, and Harvest project IDs. ' +
      'Use this to associate resources across platforms so you can reference them together later.',
    inputSchema: {
      type: 'object',
      properties: {
        name:                { type: 'string', description: 'Project name, e.g. "my-saas"' },
        github_repos:        { type: 'array', items: { type: 'string' }, description: '["owner/repo", ...]' },
        clickup_list_ids:    { type: 'array', items: { type: 'string' } },
        harvest_project_ids: { type: 'array', items: { type: 'string' } },
        notes:               { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'memory_list_project_contexts',
    description: 'List all saved project contexts.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'memory_get_project_context',
    description: 'Get a specific saved project context by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  },
];

// ─── Handler ──────────────────────────────────────────────────────────────────

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleCall(name: string, args: Record<string, any>) {
  switch (name) {
    case 'memory_link_pr_to_ticket':
      links.upsert({
        pr_url:         args.pr_url,
        pr_number:      args.pr_number ?? 0,
        repo_full_name: args.repo_full_name,
        pr_title:       args.pr_title,
        ticket_id:      args.ticket_id,
        ticket_url:     args.ticket_url ?? '',
        ticket_title:   args.ticket_title ?? '',
        project_hint:   args.project_hint ?? null,
      });
      return text({ success: true, message: `Linked PR #${args.pr_number} ↔ ticket ${args.ticket_id}` });

    case 'memory_get_prs_for_ticket':
      return text(links.getByTicket(args.ticket_id));

    case 'memory_get_tickets_for_pr':
      return text(links.getByPr(args.pr_url));

    case 'memory_list_all_links':
      return text(links.listAll());

    case 'memory_list_sync_rules':
      return text(syncRules.list());

    case 'memory_set_sync_rule':
      syncRules.upsert(args.pr_event, args.clickup_status, args.description);
      return text({ success: true, message: `Rule set: ${args.pr_event} → "${args.clickup_status}"` });

    case 'memory_delete_sync_rule':
      syncRules.delete(args.pr_event);
      return text({ success: true });

    case 'memory_get_sync_rule_for_event':
      return text(syncRules.get(args.pr_event) ?? null);

    case 'memory_save_project_context':
      projects.upsert({
        name:                args.name,
        github_repos:        args.github_repos,
        clickup_list_ids:    args.clickup_list_ids,
        harvest_project_ids: args.harvest_project_ids,
        notes:               args.notes,
      });
      return text({ success: true });

    case 'memory_list_project_contexts':
      return text(
        projects.list().map((p) => ({
          name:                p.name,
          github_repos:        JSON.parse(p.github_repos),
          clickup_list_ids:    JSON.parse(p.clickup_list_ids),
          harvest_project_ids: JSON.parse(p.harvest_project_ids),
          notes:               p.notes,
        })),
      );

    case 'memory_get_project_context': {
      const p = projects.get(args.name);
      if (!p) return text(null);
      return text({
        name:                p.name,
        github_repos:        JSON.parse(p.github_repos),
        clickup_list_ids:    JSON.parse(p.clickup_list_ids),
        harvest_project_ids: JSON.parse(p.harvest_project_ids),
        notes:               p.notes,
      });
    }

    default:
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMemoryServer(): Server {
  const server = new Server(
    { name: 'devassist-memory', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return handleCall(name, args as Record<string, any>);
    } catch (e) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: String(e) }) }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Standalone entry (for running as an external MCP server if needed) ───────

if (process.argv[1]?.endsWith('memory-server.ts') || process.argv[1]?.endsWith('memory-server.js')) {
  const server = createMemoryServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
