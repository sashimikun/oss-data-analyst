
import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data/oss-data-analyst.db');
const GITHUB_API_BASE = 'https://api.github.com';

const db = new Database(DB_PATH);

// Create tables if they don't exist
const createTables = () => {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS github_repos (
      repo_full_name TEXT PRIMARY KEY,
      stars INT,
      forks INT,
      open_issues INT,
      default_branch TEXT,
      updated_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS github_issues (
      repo TEXT,
      id INT,
      number INT,
      title TEXT,
      state TEXT,
      created_at TEXT,
      closed_at TEXT,
      author TEXT,
      labels_json TEXT,
      is_pr INT,
      PRIMARY KEY (repo, number)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS github_pulls (
      repo TEXT,
      id INT,
      number INT,
      title TEXT,
      state TEXT,
      created_at TEXT,
      closed_at TEXT,
      author TEXT,
      merged_at TEXT,
      PRIMARY KEY (repo, number)
    )
  `).run();
};

const fetchGitHub = async (url: string) => {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'oss-data-analyst-importer',
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} - ${await res.text()}`);
  }
  return res;
};

const fetchAllPages = async (url: string) => {
  let results: any[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    console.log(`Fetching ${nextUrl}...`);
    const res = await fetchGitHub(nextUrl);
    const data = await res.json();
    results = results.concat(data);

    // Handle pagination via Link header
    const linkHeader = res.headers.get('link');
    nextUrl = null;
    if (linkHeader) {
      const links = linkHeader.split(',');
      for (const link of links) {
        const match = link.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          nextUrl = match[1];
          break;
        }
      }
    }
  }
  return results;
};

const importRepo = async (repoFullName: string) => {
  console.log(`Importing ${repoFullName}...`);

  // 1. Fetch Repo Info
  const repoRes = await fetchGitHub(`${GITHUB_API_BASE}/repos/${repoFullName}`);
  const repoData = await repoRes.json();

  // Insert Repo
  db.prepare(`
    INSERT OR REPLACE INTO github_repos (repo_full_name, stars, forks, open_issues, default_branch, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    repoData.full_name,
    repoData.stargazers_count,
    repoData.forks_count,
    repoData.open_issues_count,
    repoData.default_branch,
    repoData.updated_at
  );

  // Clear existing issues/PRs for this repo
  db.prepare('DELETE FROM github_issues WHERE repo = ?').run(repoFullName);
  db.prepare('DELETE FROM github_pulls WHERE repo = ?').run(repoFullName);

  // 2. Fetch Issues (includes PRs in GitHub API, but we filter or treat them)
  // Note: /repos/{owner}/{repo}/issues returns both issues and PRs.
  // We want all of them to populate github_issues (marking is_pr), and then fetch PR specifics for github_pulls.

  const issuesUrl = `${GITHUB_API_BASE}/repos/${repoFullName}/issues?state=all&per_page=100`;
  const issues = await fetchAllPages(issuesUrl);

  const insertIssue = db.prepare(`
    INSERT INTO github_issues (repo, id, number, title, state, created_at, closed_at, author, labels_json, is_pr)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPull = db.prepare(`
    INSERT INTO github_pulls (repo, id, number, title, state, created_at, closed_at, author, merged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  console.log(`Processing ${issues.length} issues/PRs...`);

  for (const issue of issues) {
    const isPr = issue.pull_request ? 1 : 0;

    insertIssue.run(
      repoFullName,
      issue.id,
      issue.number,
      issue.title,
      issue.state,
      issue.created_at,
      issue.closed_at,
      issue.user?.login || 'unknown',
      JSON.stringify(issue.labels.map((l: any) => l.name)),
      isPr
    );

    if (isPr) {
      // If it's a PR, we might need more details (like merged_at) which are not always fully present in the issues endpoint
      // However, iterating all PRs again via /pulls endpoint is better to get merged_at correctly.
    }
  }

  // 3. Fetch Pull Requests (specifically to get merged_at and ensure we have all PR data)
  const pullsUrl = `${GITHUB_API_BASE}/repos/${repoFullName}/pulls?state=all&per_page=100`;
  const pulls = await fetchAllPages(pullsUrl);

  console.log(`Processing ${pulls.length} pull requests...`);

  for (const pull of pulls) {
    insertPull.run(
      repoFullName,
      pull.id,
      pull.number,
      pull.title,
      pull.state,
      pull.created_at,
      pull.closed_at,
      pull.user?.login || 'unknown',
      pull.merged_at
    );
  }

  console.log(`Import complete for ${repoFullName}`);
};

const main = async () => {
  createTables();

  const repo = process.env.GITHUB_REPO || 'vercel-labs/agent-browser';
  await importRepo(repo);
};

main().catch(console.error);
