import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// Environment variables
const GITHUB_REPO = process.env.GITHUB_REPO || "vercel-labs/agent-browser";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const BASE_URL = "https://api.github.com";
const PER_PAGE = 100;

// Database setup
const dataDir = join(process.cwd(), "data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir);
}
const dbPath = join(dataDir, "oss-data-analyst.db");
const db = new Database(dbPath);

console.log(`🔌 Connected to database at ${dbPath}`);
console.log(`🎯 Target Repo: ${GITHUB_REPO}`);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS github_repos (
    repo_full_name TEXT PRIMARY KEY,
    stars INT,
    forks INT,
    open_issues INT,
    default_branch TEXT,
    updated_at TEXT
  );

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
    PRIMARY KEY (repo, id)
  );

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
    PRIMARY KEY (repo, id)
  );
`);

console.log("✅ Tables initialized");

// Helper for GitHub API requests
async function fetchGithub(path: string) {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "User-Agent": "oss-data-analyst",
    "Accept": "application/vnd.github.v3+json",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `token ${GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText} (${url})`);
  }
  return res.json();
}

// Helper for pagination
async function fetchAllPages(path: string) {
  let page = 1;
  let allResults: any[] = [];

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}per_page=${PER_PAGE}&page=${page}`;
    console.log(`Fetching ${pagedPath}...`);

    const results = await fetchGithub(pagedPath);
    if (!Array.isArray(results) || results.length === 0) {
      break;
    }

    allResults = allResults.concat(results);
    if (results.length < PER_PAGE) {
      break;
    }
    page++;
  }
  return allResults;
}

async function main() {
  try {
    // 1. Fetch Repo Info
    console.log("📦 Fetching repo info...");
    const repoData = await fetchGithub(`/repos/${GITHUB_REPO}`);

    const insertRepo = db.prepare(`
      INSERT OR REPLACE INTO github_repos (repo_full_name, stars, forks, open_issues, default_branch, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertRepo.run(
      repoData.full_name,
      repoData.stargazers_count,
      repoData.forks_count,
      repoData.open_issues_count,
      repoData.default_branch,
      repoData.updated_at
    );
    console.log("✅ Repo info saved");

    // Clean up existing data for this repo to ensure idempotency
    const deleteIssues = db.prepare("DELETE FROM github_issues WHERE repo = ?");
    const deletePulls = db.prepare("DELETE FROM github_pulls WHERE repo = ?");

    deleteIssues.run(GITHUB_REPO);
    deletePulls.run(GITHUB_REPO);
    console.log("🧹 Cleaned old data for this repo");

    // 2. Fetch Issues
    console.log("🐛 Fetching issues...");
    const issues = await fetchAllPages(`/repos/${GITHUB_REPO}/issues?state=all`);

    const insertIssue = db.prepare(`
      INSERT INTO github_issues (repo, id, number, title, state, created_at, closed_at, author, labels_json, is_pr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertManyIssues = db.transaction((issues: any[]) => {
      for (const issue of issues) {
        insertIssue.run(
          GITHUB_REPO,
          issue.id,
          issue.number,
          issue.title,
          issue.state,
          issue.created_at,
          issue.closed_at,
          issue.user ? issue.user.login : null,
          JSON.stringify(issue.labels.map((l: any) => l.name)),
          issue.pull_request ? 1 : 0
        );
      }
    });

    insertManyIssues(issues);
    console.log(`✅ Saved ${issues.length} issues`);

    // 3. Fetch Pull Requests
    console.log("🚀 Fetching pull requests...");
    const pulls = await fetchAllPages(`/repos/${GITHUB_REPO}/pulls?state=all`);

    const insertPull = db.prepare(`
      INSERT INTO github_pulls (repo, id, number, title, state, created_at, closed_at, author, merged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertManyPulls = db.transaction((pulls: any[]) => {
      for (const pull of pulls) {
        insertPull.run(
          GITHUB_REPO,
          pull.id,
          pull.number,
          pull.title,
          pull.state,
          pull.created_at,
          pull.closed_at,
          pull.user ? pull.user.login : null,
          pull.merged_at
        );
      }
    });

    insertManyPulls(pulls);
    console.log(`✅ Saved ${pulls.length} pull requests`);

    console.log("🎉 Import completed successfully!");

  } catch (error) {
    console.error("❌ Error importing GitHub data:", error);
    process.exit(1);
  }
}

main();
