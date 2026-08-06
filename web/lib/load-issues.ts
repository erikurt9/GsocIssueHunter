import fs from "node:fs/promises";
import path from "node:path";

export type LocalIssue = {
  id: number;
  title: string;
  html_url: string;
  updated_at: string;
  labels?: string[];
  repo?: string;
  org?: string;
  repo_name?: string;
  repo_stars?: number;
  repo_forks?: number;
  repo_pushed_at?: string;
  es_good_first_issue?: boolean;
  es_gsoc_oficial?: boolean;
};

export type OrgSummary = {
  total_repos: number;
  total_stars: number;
  total_forks: number;
  recent_issues_count: number;
  activity_frequency: number;
  popularity_score: number;
};

export type RepoSummary = {
  stars: number;
  forks: number;
  open_issues: number;
  pushed_at: string;
  updated_at: string;
  language: string;
  recent_issues_count: number;
};

/**
 * Loads the full, unfiltered, unpaginated issue set from whichever source is
 * available (remote JSON, local issues.json, remote README, local README).
 * This mirrors the loading logic in /api/issues so both routes stay in sync.
 */
export async function loadIssues(): Promise<{
  issues: LocalIssue[];
  orgSummaries?: Record<string, OrgSummary>;
  repoSummaries?: Record<string, RepoSummary>;
}> {
  let issues: LocalIssue[] = [];
  let orgSummaries: Record<string, OrgSummary> | undefined;
  let repoSummaries: Record<string, RepoSummary> | undefined;

  const issuesJsonUrl = process.env.ISSUES_JSON_URL;
  const readmeRawUrl = process.env.README_RAW_URL;

  if (issuesJsonUrl) {
    try {
      const r = await fetch(issuesJsonUrl, { next: { revalidate: 60 } });
      if (r.ok) {
        const parsed = await r.json();
        issues = (parsed.items || []) as LocalIssue[];
        orgSummaries = parsed.org_summaries || undefined;
        repoSummaries = parsed.repo_summaries || undefined;
      }
    } catch {}
  }

  if (!issues || issues.length === 0) {
    try {
      const localIssuesPath = path.resolve(process.cwd(), "..", "issues.json");
      const file = await fs.readFile(localIssuesPath, "utf-8");
      const parsed = JSON.parse(file);
      const items = Array.isArray(parsed) ? parsed : parsed.items;
      if (Array.isArray(items)) {
        issues = items as LocalIssue[];
        orgSummaries = Array.isArray(parsed) ? undefined : parsed.org_summaries || undefined;
        repoSummaries = Array.isArray(parsed) ? undefined : parsed.repo_summaries || undefined;
      }
    } catch {}
  }

  if ((!issues || issues.length === 0) && readmeRawUrl) {
    try {
      const r = await fetch(readmeRawUrl, { next: { revalidate: 60 } });
      if (r.ok) {
        const md = await r.text();
        issues = parseReadme(md);
      }
    } catch {}
  }

  if (!issues || issues.length === 0) {
    try {
      const readmePath = path.resolve(process.cwd(), "..", "README.md");
      const md = await fs.readFile(readmePath, "utf-8");
      issues = parseReadme(md);
    } catch {}
  }

  return { issues, orgSummaries, repoSummaries };
}

function parseReadme(md: string): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const lines = md.split("\n");
  let currentRepo: string | undefined;
  const repoHeaderRE = /^##\s+\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/;
  const issueLineRE = /^\s*-\s\[(.+)\]\((https?:\/\/[^\)]+)\)/;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const repoMatch = line.match(repoHeaderRE);
    if (repoMatch) {
      currentRepo = repoMatch[1];
      continue;
    }
    const issueMatch = line.match(issueLineRE);
    if (issueMatch && currentRepo) {
      const title = issueMatch[1].trim();
      const html_url = issueMatch[2].trim();
      issues.push({
        id: Math.abs((title + html_url).split("").reduce((a, c) => a + c.charCodeAt(0), 0)),
        title,
        html_url,
        updated_at: new Date().toISOString(),
        labels: [],
        repo: currentRepo,
        org: currentRepo.split("/")[0],
        repo_name: currentRepo.split("/")[1],
      });
    }
  }
  return issues;
}
