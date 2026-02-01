import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { executeSQL as executeSQLQuery } from "@/lib/sqlite";

/**
 * Execute SQL query against SQLite database
 */
export const ExecuteSQL = tool(
  "ExecuteSQL",
  "Execute read-only SQL query against SQLite database. Returns rows and columns.",
  {
    sql: z.string().min(1),
  },
  async ({ sql }) => {
    console.log(`[ExecuteSQL] Executing: ${sql.substring(0, 100)}...`);

    try {
      const result = await executeSQLQuery(sql);

      // Convert columns array to format expected by tools
      const columns = result.columns.map((col) => ({
        name: col,
        type: "TEXT", // SQLite is dynamically typed
      }));

      const output = {
        rows: result.rows,
        columns,
        rowCount: result.rowCount,
        executionTime: result.executionTime,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        isError: false
      };
    } catch (error: any) {
      console.error(`[ExecuteSQL] Error:`, error.message);
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: false,
          error: error.message,
          rows: [],
          columns: [],
        }) }],
        isError: true,
      };
    }
  }
);
