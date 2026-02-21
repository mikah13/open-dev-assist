import { cfg } from "../utils/config.js";

const BASE = "https://api.clickup.com/api/v2";

async function cuFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: cfg.clickup.apiKey,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface CUTask {
  id: string;
  name: string;
  status: { status: string; color: string };
  description?: string;
  url: string;
  assignees: { username: string; email: string }[];
  priority: { priority: string; color: string } | null;
  due_date: string | null;
  tags: { name: string }[];
  list: { id: string; name: string };
}

export interface CUStatus {
  status: string;
  color: string;
  orderindex: number;
}

// Get a single task by ID
export async function getTask(taskId: string): Promise<CUTask> {
  const data = await cuFetch(`/task/${taskId}`) as { task?: CUTask } & CUTask;
  return data.task ?? data;
}

// Get tasks from a list (filtered by assignee, status, etc.)
export async function getTasks(opts: {
  listId?: string;
  assigneeEmails?: string[];
  statuses?: string[];
  query?: string;
  page?: number;
}): Promise<CUTask[]> {
  const listId = opts.listId ?? cfg.clickup.listId;
  if (!listId) throw new Error("No ClickUp list ID configured");

  const params = new URLSearchParams();
  if (opts.assigneeEmails?.length) {
    params.set("assignees[]", opts.assigneeEmails.join(","));
  }
  if (opts.statuses?.length) {
    opts.statuses.forEach((s) => params.append("statuses[]", s));
  }
  if (opts.query) params.set("query", opts.query);
  params.set("page", String(opts.page ?? 0));
  params.set("include_closed", "false");

  const data = await cuFetch(`/list/${listId}/task?${params}`) as { tasks: CUTask[] };
  return data.tasks;
}

// Search tasks across team
export async function searchTasks(query: string): Promise<CUTask[]> {
  const teamId = cfg.clickup.teamId;
  if (!teamId) throw new Error("No ClickUp team ID configured");

  const data = await cuFetch(
    `/team/${teamId}/task?query=${encodeURIComponent(query)}&include_closed=false`
  ) as { tasks: CUTask[] };
  return data.tasks;
}

// Update task status
export async function updateTaskStatus(taskId: string, status: string): Promise<CUTask> {
  const data = await cuFetch(`/task/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  }) as CUTask;
  return data;
}

// Get available statuses for a list
export async function getListStatuses(listId?: string): Promise<CUStatus[]> {
  const id = listId ?? cfg.clickup.listId;
  if (!id) throw new Error("No ClickUp list ID configured");

  const data = await cuFetch(`/list/${id}`) as { statuses: CUStatus[] };
  return data.statuses;
}

// Get tasks assigned to current user (uses Harvest email as proxy, or "me")
export async function getMyTasks(statuses?: string[]): Promise<CUTask[]> {
  return getTasks({ statuses });
}

// Create a comment on a task
export async function addTaskComment(taskId: string, comment: string): Promise<void> {
  await cuFetch(`/task/${taskId}/comment`, {
    method: "POST",
    body: JSON.stringify({ comment_text: comment }),
  });
}
