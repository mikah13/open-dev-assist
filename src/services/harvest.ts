import { cfg } from "../utils/config.js";

const BASE = "https://api.harvestapp.com/v2";

async function hvFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.harvest.accessToken}`,
      "Harvest-Account-Id": cfg.harvest.accountId,
      "User-Agent": "DevAssist/0.1",
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Harvest API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface HVTimeEntry {
  id: number;
  spent_date: string;
  hours: number;
  notes: string | null;
  project: { id: number; name: string };
  task: { id: number; name: string };
  user: { id: number; name: string };
  is_running: boolean;
  created_at: string;
  updated_at: string;
}

export interface HVProject {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
}

export interface HVTask {
  id: number;
  name: string;
}

// Get time entries for a date range
export async function getTimeEntries(opts: {
  from?: string; // YYYY-MM-DD
  to?: string;
  projectId?: number;
}): Promise<HVTimeEntry[]> {
  const params = new URLSearchParams();
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  if (opts.projectId) params.set("project_id", String(opts.projectId));
  params.set("per_page", "100");

  const data = await hvFetch(`/time_entries?${params}`) as { time_entries: HVTimeEntry[] };
  return data.time_entries;
}

// Get today's time entries
export async function getTodayEntries(): Promise<HVTimeEntry[]> {
  const today = new Date().toISOString().slice(0, 10);
  return getTimeEntries({ from: today, to: today });
}

// Get entries for this week
export async function getWeekEntries(): Promise<HVTimeEntry[]> {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));

  return getTimeEntries({
    from: monday.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  });
}

// Log hours
export async function logTime(opts: {
  hours: number;
  notes: string;
  spentDate?: string; // YYYY-MM-DD, defaults to today
  projectId?: number;
  taskId?: number;
}): Promise<HVTimeEntry> {
  const projectId = opts.projectId ?? parseInt(cfg.harvest.projectId, 10);
  const taskId = opts.taskId ?? parseInt(cfg.harvest.taskId, 10);

  if (!projectId) throw new Error("No Harvest project ID configured");
  if (!taskId) throw new Error("No Harvest task ID configured");

  const spentDate = opts.spentDate ?? new Date().toISOString().slice(0, 10);

  const data = await hvFetch("/time_entries", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      task_id: taskId,
      spent_date: spentDate,
      hours: opts.hours,
      notes: opts.notes,
    }),
  }) as HVTimeEntry;
  return data;
}

// Update an existing time entry
export async function updateTimeEntry(
  entryId: number,
  opts: { hours?: number; notes?: string }
): Promise<HVTimeEntry> {
  const data = await hvFetch(`/time_entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify(opts),
  }) as HVTimeEntry;
  return data;
}

// Get projects
export async function getProjects(): Promise<HVProject[]> {
  const data = await hvFetch("/projects?is_active=true&per_page=100") as {
    projects: HVProject[];
  };
  return data.projects;
}

// Get tasks for a project
export async function getProjectTasks(projectId: number): Promise<HVTask[]> {
  const data = await hvFetch(
    `/projects/${projectId}/task_assignments?per_page=100`
  ) as { task_assignments: { task: HVTask }[] };
  return data.task_assignments.map((ta) => ta.task);
}

// Sum total hours for a list of entries
export function sumHours(entries: HVTimeEntry[]): number {
  return entries.reduce((sum, e) => sum + e.hours, 0);
}
