import type { UIMessage } from "ai";
import { stepCountIs, convertToModelMessages, tool, ToolLoopAgent } from "ai";
import z from "zod";
import { ExecuteSQL } from "./tools/execute-sqlite";
import { createSandbox } from "./tools/sandbox";
import { createSemanticBashTools } from "./tools/shell";

const FinalizeReportSchema = z.object({
  sql: z.string(),
  csvResults: z.string(),
  narrative: z.string().min(1),
});

const FinalizeReport = tool({
  description: "Finalize the report with SQL, CSV results, and narrative.",
  inputSchema: FinalizeReportSchema,
  outputSchema: FinalizeReportSchema,
  execute: async (input) => input,
});

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

export async function runAgent({
  messages,
  model = "anthropic/claude-opus-4.5",
}: {
  messages: UIMessage[];
  model?: string;
}) {
  const { sandbox, stop } = await createSandbox();
  const { tools: bashTools } = await createSemanticBashTools(sandbox);

  // Initialize the ToolLoopAgent which handles the iterative tool execution loop.
  // It will automatically call tools and feed results back to the model until completion.
  const agent = new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    tools: {
      bash: bashTools.bash,
      ExecuteSQL,
      FinalizeReport,
    },
    // Custom stopping conditions to prevent infinite loops and ensure proper termination
    stopWhen: [
      // Stop if FinalizeReport has been called in any previous step
      (ctx: any) =>
        ctx.steps.some((step: any) =>
          step.toolResults?.some((t: any) => t.toolName === "FinalizeReport")
        ),
      // Hard limit on steps to prevent runaway costs
      stepCountIs(100),
    ],
    // Ensure sandbox is cleaned up when the agent finishes
    onFinish: async () => {
      await stop();
    },
  });

  const result = agent.stream({
    messages: await convertToModelMessages(messages),
  });

  return result;
}

/**
 * Runs the agent and returns both the result and the sandbox for further use.
 * Caller is responsible for stopping the sandbox when done.
 */
export async function runAgentWithSandbox({
  messages,
  model = "anthropic/claude-opus-4.5",
}: {
  messages: UIMessage[];
  model?: string;
}) {
  const { sandbox, stop } = await createSandbox();
  const { tools: bashTools } = await createSemanticBashTools(sandbox);

  // Initialize the ToolLoopAgent for the sandbox version (cleanup handled by caller)
  const agent = new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    tools: {
      bash: bashTools.bash,
      ExecuteSQL,
      FinalizeReport,
    },
    stopWhen: [
      (ctx: any) =>
        ctx.steps.some((step: any) =>
          step.toolResults?.some((t: any) => t.toolName === "FinalizeReport")
        ),
      stepCountIs(100),
    ],
  });

  const result = agent.stream({
    messages: await convertToModelMessages(messages),
  });

  return { result, sandbox, stop };
}

type FinalizeReportOutput = z.infer<typeof FinalizeReportSchema>;

export const extractFinalizeReport = (result: {
  toolResults: Array<{ toolName: string; output?: unknown }>;
}) => {
  const finalResult = result.toolResults.find(
    (t) => t.toolName === "FinalizeReport"
  );

  const output = (finalResult?.output || {}) as Partial<FinalizeReportOutput>;

  return {
    hasFinalResult: finalResult != null,
    sql: output.sql,
    csvResults: output.csvResults,
    narrative: output.narrative,
  };
};
