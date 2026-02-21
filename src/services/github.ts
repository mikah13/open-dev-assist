import { Octokit } from "@octokit/rest";
import { cfg } from "../utils/config.js";

let _octokit: Octokit | null = null;

function octokit(): Octokit {
  if (!_octokit) {
    _octokit = new Octokit({ auth: cfg.github.token });
  }
  return _octokit;
}

function parseRepo(repoStr?: string): { owner: string; repo: string } {
  const r = repoStr ?? `${cfg.github.owner}/${cfg.github.repo}`;
  const [owner, repo] = r.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo format: ${r} (expected owner/repo)`);
  return { owner, repo };
}

export interface GHPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  draft: boolean;
  labels: { name: string }[];
  requested_reviewers: { login: string }[];
  review_decision?: string;
}

export interface GHReview {
  user: { login: string } | null;
  state: string;
  submitted_at: string | null;
  body: string;
}

// List open PRs
export async function listPRs(
  repo?: string,
  state: "open" | "closed" | "all" = "open"
): Promise<GHPullRequest[]> {
  const { owner, repo: r } = parseRepo(repo);
  const res = await octokit().pulls.list({
    owner,
    repo: r,
    state,
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });
  return res.data as GHPullRequest[];
}

// Get a single PR
export async function getPR(prNumber: number, repo?: string): Promise<GHPullRequest> {
  const { owner, repo: r } = parseRepo(repo);
  const res = await octokit().pulls.get({ owner, repo: r, pull_number: prNumber });
  return res.data as GHPullRequest;
}

// Get PR reviews
export async function getPRReviews(prNumber: number, repo?: string): Promise<GHReview[]> {
  const { owner, repo: r } = parseRepo(repo);
  const res = await octokit().pulls.listReviews({ owner, repo: r, pull_number: prNumber });
  return res.data as GHReview[];
}

// Create a PR
export async function createPR(params: {
  title: string;
  body: string;
  head: string;
  base?: string;
  draft?: boolean;
  repo?: string;
}): Promise<GHPullRequest> {
  const { owner, repo: r } = parseRepo(params.repo);
  const res = await octokit().pulls.create({
    owner,
    repo: r,
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base ?? "main",
    draft: params.draft ?? false,
  });
  return res.data as GHPullRequest;
}

// List branches
export async function listBranches(repo?: string): Promise<string[]> {
  const { owner, repo: r } = parseRepo(repo);
  const res = await octokit().repos.listBranches({ owner, repo: r, per_page: 100 });
  return res.data.map((b) => b.name);
}

// Get commits for a branch
export async function getBranchCommits(
  branch: string,
  repo?: string,
  limit = 10
): Promise<{ sha: string; message: string; author: string; date: string }[]> {
  const { owner, repo: r } = parseRepo(repo);
  const res = await octokit().repos.listCommits({
    owner,
    repo: r,
    sha: branch,
    per_page: limit,
  });
  return res.data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    author: c.commit.author?.name ?? "unknown",
    date: c.commit.author?.date ?? "",
  }));
}

// Add a PR comment
export async function addPRComment(
  prNumber: number,
  comment: string,
  repo?: string
): Promise<void> {
  const { owner, repo: r } = parseRepo(repo);
  await octokit().issues.createComment({
    owner,
    repo: r,
    issue_number: prNumber,
    body: comment,
  });
}

// Add PR labels
export async function addPRLabels(
  prNumber: number,
  labels: string[],
  repo?: string
): Promise<void> {
  const { owner, repo: r } = parseRepo(repo);
  await octokit().issues.addLabels({
    owner,
    repo: r,
    issue_number: prNumber,
    labels,
  });
}

// Get repo info
export async function getRepoInfo(repo?: string) {
  const { owner, repo: r } = parseRepo(repo);
  const res = await octokit().repos.get({ owner, repo: r });
  return {
    name: res.data.name,
    fullName: res.data.full_name,
    defaultBranch: res.data.default_branch,
    description: res.data.description,
    language: res.data.language,
  };
}
