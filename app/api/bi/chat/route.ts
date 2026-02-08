import {
  streamText,
  UIMessage,
  convertToModelMessages,
  validateUIMessages,
  TypeValidationError,
} from "ai";
import { createOpenAI } from '@ai-sdk/openai';
import {
  type InferUITools,
  type UIDataTypes,
  stepCountIs,
} from 'ai';
import { requireAuth } from '@/lib/auth/auth';
import { getEffectiveOpenAIConfig } from '@/lib/services/settings';
import { mssqlTools } from '@/lib/rdbms/mssql/tools';
import { tool } from 'ai';
import { z } from 'zod';
import { biConfigSchema } from '@/lib/types/bi';

// Tools will be created with user context below

export type BITools = InferUITools<typeof mssqlTools & { saveBIConfig: any }>;
export type BIMessage = UIMessage<never, UIDataTypes, BITools>;

export const POST = requireAuth(async (req, user) => {
  try {
    const body = await req.json();
    const messages = (body?.messages ?? []) as BIMessage[];

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return Response.json({ error: "User message is required" }, { status: 400 });
    }

    // Create tools with user context first (needed for validation)
    const toolsWithContext = {
      ...mssqlTools,
      saveBIConfig: tool({
        description: "Save a BI dashboard configuration to the database. Call this AFTER you have generated a complete BI config JSON object. You must generate the BI config JSON yourself based on the query results you received from runReadOnlySQLMssql. The config should include widgets with chart types (BarChart, PieChart, LineChart, AreaChart), titles, dataSource URLs, and chart configurations. Once you have the complete config object, call this tool to save it.",
        inputSchema: z.object({
          title: z.string().describe("Title for the BI dashboard"),
          config: z.string().describe("The complete BI configuration JSON object as a string (must be valid JSON matching the BI config schema)"),
        }),
        execute: async (args: any) => {
          // Set userId in request context before calling tool
          const { setCurrentRequestUserId } = await import("@/lib/bi/query-store");
          setCurrentRequestUserId(user.id);
          // Import and call the tool
          const { biTools } = await import("@/lib/bi/tools");
          return (biTools.saveBIConfig.execute as any)(args);
        },
      }),
    };

    // Validate messages
    let validatedMessages: UIMessage[];
    try {
      validatedMessages = await validateUIMessages({
        messages,
        tools: toolsWithContext as any,
      });
    } catch (error) {
      if (error instanceof TypeValidationError) {
        validatedMessages = messages;
      } else {
        throw error;
      }
    }

    const effective = await getEffectiveOpenAIConfig();
    
    // Track the last SQL query result and BI ID
    let lastQueryResult: any[] | null = null;
    let savedBiId: string | null = null;
    const { setCurrentRequestQueryData, clearCurrentRequestQueryData } = await import("@/lib/bi/query-store");

    const result = streamText({
      model: createOpenAI({ baseURL: effective.baseURL, apiKey: effective.apiKey }).chat("gpt-oss-120b"),
      messages: convertToModelMessages(validatedMessages),
      stopWhen: stepCountIs(10), // Allow more steps for database exploration
      tools: toolsWithContext,
      system: `You are OrangeAi 🍊, an expert Business Intelligence (BI) dashboard assistant for Microsoft SQL Server (MSSQL).

Your goal is to help users create BI dashboards by:
1. Understanding what data they want to visualize
2. Exploring the database using MSSQL tools to find the right tables and columns
3. Running SQL queries to retrieve the data
4. Generating a BI dashboard configuration
5. Saving the dashboard

Available MSSQL tools (all end with "Mssql"):
- listSchemasMssql: List all schemas in the database
- listTablesMssql: List tables (optionally in a specific schema)
- listColumnsMssql: List columns for a specific table
- runReadOnlySQLMssql: Execute a SELECT/CTE query and get results as JSON

Available BI tools:
- saveBIConfig: Save the final BI dashboard configuration that YOU generate

CRITICAL - BI Config Generation:
After you receive data from runReadOnlySQLMssql, YOU must generate a complete BI dashboard configuration JSON yourself. 

The BI config structure:
{
  "title": "Dashboard Title",
  "layout": {
    "columns": 2,
    "gap": "gap-6",
    "maxWidth": "max-w-7xl",
    "centered": true
  },
  "widgets": [
    {
      "id": "unique-id-1",
      "type": "BarChart" | "PieChart" | "LineChart" | "AreaChart",
      "title": "Chart Title",
      "description": "Optional description",
      "className": "col-span-2 lg:col-span-1",
      "options": {
        "showCard": true,
        "cardClassName": "bg-white dark:bg-neutral-800 shadow-sm rounded-xl p-4 border border-border",
        "showLegend": true
      },
      "dataSource": {
        "type": "json",
        "data": [{"column1": "value1", "column2": 100}, ...]
      },
      "chart": {
        "xKey": "column_name_for_x_axis",
        "yKey": "column_name_for_y_axis",
        "yKeys": ["col1", "col2"], // for multiple series
        "nameKey": "column_name", // for pie charts
        "valueKey": "column_name", // for pie charts
        "color": "#4f46e5", // single color
        "colors": ["#f97316", "#22c55e", "#0ea5e9"] // array of colors
      }
    }
  ]
}

For dataSource, use the data you received from runReadOnlySQLMssql directly:
- Set type to "json"
- Set data to the array of results from runReadOnlySQLMssql
- Example: if runReadOnlySQLMssql returned [{"month": 1, "sales": 1000}, {"month": 2, "sales": 1500}], use that exact array in dataSource.data

Workflow:
1. Explore database: listSchemasMssql → listTablesMssql → listColumnsMssql
2. Query data: runReadOnlySQLMssql (returns JSON array of rows)
3. Analyze the data structure and columns
4. Generate complete BI config JSON yourself based on the data
5. **CRITICAL: You MUST actually CALL the saveBIConfig tool - do NOT just describe it in text!**

CRITICAL INSTRUCTIONS FOR saveBIConfig:
- After generating the BI config JSON, you MUST immediately call the saveBIConfig tool using the tool calling mechanism
- Do NOT write text like "I will call saveBIConfig" or "Now I will save this dashboard"
- Do NOT show JSON examples or describe what you would do
- Do NOT write text that looks like {"tool": "saveBIConfig", ...} - that is just text, NOT a tool call!
- You must use the actual tool calling system - the same way you call listSchemasMssql or runReadOnlySQLMssql
- The tool expects: title (string) and config (JSON string)
- Convert your config object to a JSON string: JSON.stringify(yourConfigObject)
- After generating the config, immediately call the saveBIConfig tool with: { title: "Your Title", config: JSON.stringify(yourConfigObject) }
- Do not explain, do not describe - just call the tool immediately after generating the config
- If you write text instead of calling the tool, the dashboard will NOT be saved!

WRONG (DO NOT DO THIS):
- Writing: "Now I will save this dashboard configuration" and then showing JSON
- Writing: {"tool": "saveBIConfig", "toolInput": {...}} in text
- Describing what you would do instead of doing it

CORRECT (DO THIS):
- After generating config, immediately call saveBIConfig tool (the system will show tool-input-start event)
- Use the tool calling mechanism exactly like you use runReadOnlySQLMssql
- The tool call will appear in the stream as: {"type":"tool-input-start","toolName":"saveBIConfig",...}

Important:
- Always explore database first - don't guess table/column names
- SQL queries must return at least 2 columns suitable for charting
- YOU generate the BI config JSON - don't ask the system to do it
- Choose appropriate chart types: BarChart for categories, LineChart for time series, PieChart for proportions, AreaChart for cumulative data
- For dataSource, embed the query results directly: { "type": "json", "data": [your query results array] }
- The data from runReadOnlySQLMssql should be embedded directly in the dataSource.data field
- **MOST IMPORTANT: After generating config, IMMEDIATELY call saveBIConfig tool - do not explain or describe, just call it**

Example:
User: "Show me sales by month"
You:
1. listSchemasMssql
2. listTablesMssql
3. listColumnsMssql (schema, "sales")
4. runReadOnlySQLMssql: "SELECT MONTH(date) as month, SUM(amount) as sales FROM sales GROUP BY MONTH(date)"
5. Analyze returned data: [{month: 1, sales: 1000}, {month: 2, sales: 1500}, ...]
6. Generate BI config JSON object with dataSource: { "type": "json", "data": [the exact array from step 5] }
7. **IMMEDIATELY call saveBIConfig tool with title="Sales by Month" and config=JSON.stringify(yourConfigObject)**`,
      onStepFinish: async ({ toolCalls, toolResults }) => {
        // Intercept runReadOnlySQLMssql results and store for tool access
        if (toolResults) {
          for (const toolResult of toolResults) {
            if (toolResult.toolName === 'runReadOnlySQLMssql' && 'result' in toolResult) {
              try {
                const result = (toolResult as any).result;
                const parsed = typeof result === 'string' 
                  ? JSON.parse(result) 
                  : result;
                if (Array.isArray(parsed)) {
                  lastQueryResult = parsed;
                  setCurrentRequestQueryData(parsed);
                }
              } catch (e) {
                console.error("Failed to parse query result:", e);
              }
            }
            // Intercept saveBIConfig to get BI ID
            if (toolResult.toolName === 'saveBIConfig' && 'result' in toolResult) {
              try {
                const result = (toolResult as any).result;
                const parsed = typeof result === 'string' ? JSON.parse(result) : result;
                if (parsed.biId) {
                  savedBiId = parsed.biId;
                }
              } catch (e) {
                console.error("Failed to parse saveBIConfig result:", e);
              }
            }
          }
        }
      },
    });

    // Ensure stream runs to completion
    result.consumeStream();

    // Get the response stream
    const response = result.toUIMessageStreamResponse({
      originalMessages: validatedMessages,
      generateMessageId: () => crypto.randomUUID(),
      onFinish: async () => {
        // Clean up request context
        clearCurrentRequestQueryData();
        
        if (savedBiId) {
          console.log('✅ BI Dashboard created with ID:', savedBiId);
        }
      },
    });

    // Store savedBiId in response metadata for client to access
    // We'll check for it in the stream by intercepting saveBIConfig tool results
    // The client will parse the stream to find the BI ID
    
    return response;
  } catch (error: any) {
    console.error("BI Chat API Error:", error);
    return Response.json(
      { error: error.message || "Failed to process BI request" },
      { status: 500 }
    );
  }
});
