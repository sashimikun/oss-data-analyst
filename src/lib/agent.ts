import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import z from "zod";
import { ExecuteSQL } from "./tools/execute-sqlite";
import path from "path";

const FinalizeReportSchema = {
  sql: z.string(),
  csvResults: z.string(),
  narrative: z.string().min(1),
};

const FinalizeReport = tool(
  "FinalizeReport",
  "Finalize the report with SQL, CSV results, and narrative.",
  FinalizeReportSchema,
  async (input) => {
    return {
      content: [{ type: "text", text: JSON.stringify(input) }],
      isError: false,
    };
  }
);

const SYSTEM_PROMPT = `You are an expert data analyst AI. You answer questions by exploring a semantic layer (YAML schema files), building SQL queries for SQLite, executing them, and presenting results.

## Filesystem Structure
- semantic/catalog.yml - Entity catalog with descriptions, example questions, and field lists
- semantic/entities/*.yml - Detailed entity definitions with SQL expressions, joins, and field metadata

## Workflow

### 1. Schema Exploration
Use the bash tool to find relevant entities and fields:
- \`cat semantic/catalog.yml\` - Browse all entities
- \`grep -r "keyword" semantic/\` - Search for terms
- \`cat semantic/entities/<name>.yml\` - Get entity details (SQL expressions, joins)

### 2. SQL Building
Construct a SQLite SELECT query using sql_table_name from entity definitions. Use table aliases (t0, t1), apply filters, GROUP BY for aggregations, ORDER BY, and LIMIT 1001.

### 3. Execution
Call ExecuteSQL with your query. If error:
- Analyze the error message carefully
- Fix the SQL to address the specific issue (wrong column name, syntax error, etc.)
- Try a DIFFERENT query - never retry the exact same SQL
- If you see repeated failures, stop retrying and call FinalizeReport explaining the issue
- Maximum 2 retry attempts, then report failure

### 4. Reporting
Call FinalizeReport with:
- sql: the final SQL query that was executed (or attempted)
- csvResults: the results as CSV text (header row + data rows), or empty string if no results
- narrative: clear answer to the question with the data, assumptions, and caveats

## Guidelines
- Always explore schema before writing SQL - never guess field names
- Use only fields from entity YAML files
- Lead with the direct answer, then context
- Keep narratives concise (3-6 sentences)
- Never retry the same failing SQL - always modify it first
- Format large numbers with underscores instead of commas (e.g., 1_234_567 not 1,234,567)

- Today is ${new Date().toISOString().split("T")[0]}
`;

export type Phase = "planning" | "building" | "execution" | "reporting";

const mcpServer = createSdkMcpServer({
  name: "data-analyst-tools",
  version: "1.0.0",
  tools: [ExecuteSQL, FinalizeReport],
});

export async function runAgent({
  message,
  sessionId,
  model = "anthropic/claude-opus-4.5",
}: {
  message: string;
  sessionId?: string;
  model?: string;
}) {
  const result = query({
    prompt: message,
    options: {
      model,
      systemPrompt: SYSTEM_PROMPT,
      resume: sessionId,
      tools: ["Bash"], // Use built-in Bash tool
      mcpServers: {
        "data-analyst-tools": mcpServer,
      },
      additionalDirectories: [path.join(process.cwd(), "src", "semantic")],
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
      },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  return result;
}
