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
import { biTools } from '@/lib/bi/tools';
import { generateObject } from "ai";
import { biConfigSchema } from "@/lib/types/bi";
import { createBIDashboard } from "@/lib/db";

const tools = { ...mssqlTools, ...biTools } as const;

export type BITools = InferUITools<typeof tools>;
export type BIMessage = UIMessage<never, UIDataTypes, BITools>;

export const POST = requireAuth(async (req, user) => {
  try {
    const body = await req.json();
    const messages = (body?.messages ?? []) as BIMessage[];

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return Response.json({ error: "User message is required" }, { status: 400 });
    }

    // Validate messages
    let validatedMessages: UIMessage[];
    try {
      validatedMessages = await validateUIMessages({
        messages,
        tools: tools as any,
      });
    } catch (error) {
      if (error instanceof TypeValidationError) {
        validatedMessages = messages;
      } else {
        throw error;
      }
    }

    const effective = await getEffectiveOpenAIConfig();
    
    // Track the last SQL query result
    let lastQueryResult: any[] | null = null;
    let userQuery = "";

    // Extract user query from messages
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (lastUserMessage) {
      const parts = (lastUserMessage as any).parts || [];
      userQuery = parts.find((p: any) => p.type === 'text')?.text || "";
    }

    const result = streamText({
      model: createOpenAI({ baseURL: effective.baseURL, apiKey: effective.apiKey }).chat("gpt-oss-120b"),
      messages: convertToModelMessages(validatedMessages),
      stopWhen: stepCountIs(10), // Allow more steps for database exploration
      tools,
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
- generateBIConfig: Process query results (call this after getting data from runReadOnlySQLMssql)
- saveBIConfig: Save the final BI dashboard configuration

Workflow:
1. When user asks for a dashboard, first explore the database structure using listSchemasMssql, listTablesMssql, listColumnsMssql
2. Once you understand the schema, use runReadOnlySQLMssql to query the data the user wants
3. After runReadOnlySQLMssql returns data, call generateBIConfig to process it
4. The system will automatically generate the BI config JSON from the query results
5. Finally, call saveBIConfig with a good title and the generated config

Important:
- Always use MSSQL tools to explore the database first - don't guess table/column names
- Make sure your SQL queries return at least 2 columns suitable for charting
- Return quantitative data that can be visualized
- The BI config will be generated automatically after you call runReadOnlySQLMssql - you just need to call saveBIConfig with the result

Example flow:
User: "Show me sales by month"
You: 
1. listSchemasMssql
2. listTablesMssql (to find sales table)
3. listColumnsMssql (to see what columns exist)
4. runReadOnlySQLMssql (with query like "SELECT MONTH(date) as month, SUM(amount) as sales FROM sales GROUP BY MONTH(date)")
5. generateBIConfig (to process the results)
6. saveBIConfig (with title and config)`,
      onStepFinish: async ({ toolCalls, toolResults }) => {
        // Intercept runReadOnlySQLMssql results
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
                }
              } catch (e) {
                console.error("Failed to parse query result:", e);
              }
            }
          }
        }
      },
    });

    // Ensure stream runs to completion
    result.consumeStream();

    // Track BI ID for response
    let savedBiId: string | null = null;

    // Get the response stream
    const response = result.toUIMessageStreamResponse({
      originalMessages: validatedMessages,
      generateMessageId: () => crypto.randomUUID(),
      onFinish: async ({ responseMessage }) => {
        // After stream completes, check for SQL query results and generate BI config
        let queryData: any[] | null = null;

        // Check lastQueryResult from onStepFinish (captured during streaming)
        if (lastQueryResult) {
          queryData = lastQueryResult;
        } else {
          // Try to extract from response message tool calls
          if (responseMessage && 'toolCalls' in responseMessage && responseMessage.toolCalls) {
            // Tool results are not directly available here, so we rely on onStepFinish
            console.log("Tool calls found but results captured in onStepFinish");
          }
        }

        // Generate BI config and save if we have data
        if (queryData && queryData.length > 0) {
          try {
            const columns = Object.keys(queryData[0]);
            const sampleData = queryData.slice(0, 10);

            // Generate BI config using AI
            const biConfigResult = await generateObject({
              model: createOpenAI({ baseURL: effective.baseURL, apiKey: effective.apiKey })("gpt-oss-120b"),
              system: `You are a Business Intelligence (BI) dashboard configuration expert. Create a JSON configuration for a BI dashboard based on SQL query results.

Available chart types: BarChart, PieChart, LineChart, AreaChart

For layout:
- Use 2 columns for most dashboards
- Use 3 columns if you have many small charts
- Use 1 column if charts need full width

Each widget needs:
- A unique id
- A chart type appropriate for the data
- A title describing what it shows
- A description (optional)
- className for responsive layout (e.g., "col-span-2 lg:col-span-1")
- dataSource with type "api" and url pointing to the data
- chart configuration with appropriate keys

For chart configuration:
- BarChart/LineChart/AreaChart: use xKey for x-axis, yKey or yKeys for y-axis
- PieChart: use nameKey for labels, valueKey for values
- Use colors array for multiple series`,
              prompt: `Create a BI dashboard configuration for the following data.

User Query: ${userQuery}

Available Columns: ${columns.join(", ")}

Sample Data (first 10 rows):
${JSON.stringify(sampleData, null, 2)}

Generate a comprehensive dashboard configuration with appropriate charts.`,
              schema: biConfigSchema,
            });

            const biConfig = biConfigResult.object;

            // Store query results and update dataSource URLs
            const queryId = crypto.randomUUID();
            const { storeQueryResult } = await import("@/lib/bi/query-store");
            storeQueryResult(queryId, queryData);

            const updatedWidgets = biConfig.widgets.map((widget) => ({
              ...widget,
              dataSource: {
                type: "api" as const,
                url: `/api/bi/data/${queryId}`,
              },
            }));

            const finalConfig = {
              ...biConfig,
              widgets: updatedWidgets,
            };

            // Save to database
            const title = biConfig.title || `BI Dashboard - ${new Date().toLocaleDateString()}`;
            savedBiId = await createBIDashboard(user.id, title, JSON.stringify(finalConfig));
            
            console.log('✅ BI Dashboard created with ID:', savedBiId);
          } catch (error: any) {
            console.error("Failed to generate/save BI config:", error);
          }
        }
      },
    });

    // Add BI ID to response headers if available
    // Note: Headers can't be modified after stream starts, so we'll send it in the stream
    // For now, we'll use a workaround by wrapping the response
    if (savedBiId) {
      // We'll need to modify the stream to include the BI ID
      // For simplicity, let's add it as a custom header before returning
      // But since it's async, we'll send it via a special message in the stream
      const originalBody = response.body;
      if (originalBody) {
        const reader = originalBody.getReader();
        const stream = new ReadableStream({
          async start(controller) {
            // First, send a special control message with BI ID
            const encoder = new TextEncoder();
            const biIdMessage = `0:{"type":"bi-id","biId":"${savedBiId}"}\n`;
            controller.enqueue(encoder.encode(biIdMessage));
            
            // Then, forward the original stream
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          },
        });
        
        return new Response(stream, {
          headers: {
            ...Object.fromEntries(response.headers.entries()),
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }
    }

    return response;
  } catch (error: any) {
    console.error("BI Chat API Error:", error);
    return Response.json(
      { error: error.message || "Failed to process BI request" },
      { status: 500 }
    );
  }
});
