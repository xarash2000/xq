import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/auth";
import { getEffectiveOpenAIConfig } from "@/lib/services/settings";
import { executeReadOnlySQL } from "@/lib/rdbms/mssql/sql";
import { biConfigSchema } from "@/lib/types/bi";
import { storeQueryResult } from "@/lib/bi/query-store";

export const POST = requireAuth(async (req, user) => {
  try {
    const body = await req.json();
    const { message, previousConfig } = body;

    if (!message || typeof message !== "string") {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const effective = await getEffectiveOpenAIConfig();

    // Step 1: Generate SQL query from user message
    const sqlResult = await generateObject({
      model: createOpenAI({ baseURL: effective.baseURL, apiKey: effective.apiKey })("gpt-oss-120b"),
      system: `You are a Microsoft SQL Server (MSSQL) expert. Your job is to translate a natural language question into a safe, read-only SQL query (SELECT/CTE only).

Guidelines:
- Prefer returning at least two columns suitable for charting when possible.
- Use LIKE for case-insensitive matching (or COLLATE for case-insensitive).
- Qualify tables with schema if ambiguity is likely.
- Use CTEs for clarity on multi-step logic.
- Never include mutating statements (INSERT/UPDATE/DELETE/ALTER/TRUNCATE/CREATE/DROP/GRANT/REVOKE).
- Return results that are easy to visualize (include at least two columns when possible).
- If the user asks for 'over time' data, return by year or month.
- EVERY QUERY SHOULD RETURN QUANTITATIVE DATA THAT CAN BE PLOTTED ON A CHART!`,
      prompt: `Generate the SQL query necessary to retrieve the data the user wants: ${message}`,
      schema: z.object({
        query: z.string(),
      }),
    });

    const sqlQuery = sqlResult.object.query;

    // Step 2: Execute SQL query
    let queryData: any[];
    try {
      queryData = await executeReadOnlySQL({ sql: sqlQuery });
    } catch (error: any) {
      return Response.json(
        { error: `Failed to execute SQL query: ${error.message}` },
        { status: 500 }
      );
    }

    if (!queryData || queryData.length === 0) {
      return Response.json(
        { error: "Query returned no results" },
        { status: 400 }
      );
    }

    // Step 3: Store query results with a unique ID
    const queryId = crypto.randomUUID();
    storeQueryResult(queryId, queryData);

    // Step 4: Generate BI config from query results
    const columns = Object.keys(queryData[0]);
    const sampleData = queryData.slice(0, 10); // First 10 rows for context

    const biConfigResult = await generateObject({
      model: createOpenAI({ baseURL: effective.baseURL, apiKey: effective.apiKey })("gpt-oss-120b"),
      system: `You are a Business Intelligence (BI) dashboard configuration expert. Your job is to create a JSON configuration for a BI dashboard based on SQL query results.

The dashboard should display charts that best visualize the data and answer the user's query. You can create multiple widgets (charts) if needed.

Available chart types: BarChart, PieChart, LineChart, AreaChart

For the layout:
- Use 2 columns for most dashboards
- Use 3 columns if you have many small charts
- Use 1 column if charts need to be full width

Each widget should have:
- A unique id
- A chart type appropriate for the data
- A title describing what it shows
- A description (optional)
- className for responsive layout (e.g., "col-span-2 lg:col-span-1")
- dataSource pointing to /api/bi/data/[queryId]
- chart configuration with appropriate keys

For chart configuration:
- BarChart/LineChart/AreaChart: use xKey for x-axis, yKey or yKeys for y-axis
- PieChart: use nameKey for labels, valueKey for values
- Use colors array for multiple series or different chart elements`,
      prompt: `Create a BI dashboard configuration for the following data.

User Query: ${message}

Available Columns: ${columns.join(", ")}

Sample Data (first 10 rows):
${JSON.stringify(sampleData, null, 2)}

${previousConfig ? `Previous Config (user may want to modify this):\n${JSON.stringify(previousConfig, null, 2)}` : ""}

Generate a comprehensive dashboard configuration with appropriate charts. If the data has multiple dimensions, create multiple widgets.`,
      schema: biConfigSchema,
    });

    const biConfig = biConfigResult.object;

    // Update dataSource URLs to use the queryId
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

    return Response.json({
      config: finalConfig,
      queryId,
      sqlQuery,
    });
  } catch (error: any) {
    console.error("BI Chat API Error:", error);
    return Response.json(
      { error: error.message || "Failed to generate BI configuration" },
      { status: 500 }
    );
  }
});

