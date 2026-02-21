import { config } from "dotenv";
import { homedir } from "os";
import { join } from "path";

// Load .env from cwd or home
config({ path: ".env" });
config({ path: join(homedir(), ".dev-assist", ".env") });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const cfg = {
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
  },
  clickup: {
    apiKey: required("CLICKUP_API_KEY"),
    teamId: optional("CLICKUP_TEAM_ID", ""),
    listId: optional("CLICKUP_LIST_ID", ""),
  },
  github: {
    token: required("GITHUB_TOKEN"),
    owner: optional("GITHUB_OWNER", ""),
    repo: optional("GITHUB_REPO", ""),
  },
  harvest: {
    accessToken: required("HARVEST_ACCESS_TOKEN"),
    accountId: required("HARVEST_ACCOUNT_ID"),
    projectId: optional("HARVEST_PROJECT_ID", ""),
    taskId: optional("HARVEST_TASK_ID", ""),
  },
  db: {
    path: optional("DB_PATH", join(homedir(), ".dev-assist", "memory.db")),
  },
  app: {
    defaultHoursPerDay: parseInt(optional("DEFAULT_HOURS_PER_DAY", "8"), 10),
  },
} as const;
