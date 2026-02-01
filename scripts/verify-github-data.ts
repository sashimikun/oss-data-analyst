import Database from "better-sqlite3";
import { join } from "path";

const dbPath = join(process.cwd(), "data", "oss-data-analyst.db");
const db = new Database(dbPath);
const REPO = "vercel-labs/agent-browser";

console.log(`🔍 Verifying data for ${REPO}...`);

// 1. Open Issues Count
const openIssues = db.prepare(`
  SELECT COUNT(*) as count
  FROM github_issues
  WHERE repo = ? AND state = 'open' AND is_pr = 0
`).get(REPO) as { count: number };
console.log(`\n1. Open Issues: ${openIssues.count}`);

// 2. Top Labels
const issues = db.prepare(`
  SELECT labels_json
  FROM github_issues
  WHERE repo = ? AND is_pr = 0
`).all(REPO) as { labels_json: string }[];

const labelCounts: Record<string, number> = {};
issues.forEach(issue => {
  const labels = JSON.parse(issue.labels_json || "[]");
  labels.forEach((label: string) => {
    labelCounts[label] = (labelCounts[label] || 0) + 1;
  });
});

console.log("\n2. Top Labels:");
Object.entries(labelCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([label, count]) => console.log(`   - ${label}: ${count}`));

// 3. Median time-to-close
const closedIssues = db.prepare(`
  SELECT created_at, closed_at
  FROM github_issues
  WHERE repo = ? AND state = 'closed' AND is_pr = 0 AND closed_at IS NOT NULL
`).all(REPO) as { created_at: string, closed_at: string }[];

const durations = closedIssues.map(i => {
  return new Date(i.closed_at).getTime() - new Date(i.created_at).getTime();
}).sort((a, b) => a - b);

const medianDurationMs = durations[Math.floor(durations.length / 2)];
const medianHours = (medianDurationMs / (1000 * 60 * 60)).toFixed(2);
console.log(`\n3. Median Time-to-Close: ${medianHours} hours (${closedIssues.length} closed issues)`);

// 4. Top PR Authors by Merged PRs
const topAuthors = db.prepare(`
  SELECT author, COUNT(*) as count
  FROM github_pulls
  WHERE repo = ? AND merged_at IS NOT NULL
  GROUP BY author
  ORDER BY count DESC
  LIMIT 5
`).all(REPO) as { author: string, count: number }[];

console.log("\n4. Top PR Authors (Merged):");
topAuthors.forEach(a => console.log(`   - ${a.author}: ${a.count}`));

// 5. PR Merge Rate
const allPulls = db.prepare(`
  SELECT created_at, merged_at
  FROM github_pulls
  WHERE repo = ?
`).all(REPO) as { created_at: string, merged_at: string | null }[];

const mergedCount = allPulls.filter(p => p.merged_at).length;
const totalCount = allPulls.length;
const rate = ((mergedCount / totalCount) * 100).toFixed(1);
console.log(`\n5. Overall Merge Rate: ${rate}% (${mergedCount}/${totalCount})`);
