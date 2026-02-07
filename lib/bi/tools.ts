import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { biConfigSchema } from "@/lib/types/bi";
import { prisma } from "@/lib/db";

export const biTools = {
  saveBIConfig: tool({
    description: "Save a BI dashboard configuration to the database. Call this AFTER you have generated a complete BI config JSON object. You must generate the BI config JSON yourself based on the query results you received from runReadOnlySQLMssql. The config should include widgets with chart types (BarChart, PieChart, LineChart, AreaChart), titles, dataSource URLs, and chart configurations. Once you have the complete config object, call this tool to save it.",
    inputSchema: z.object({
      title: z.string().describe("Title for the BI dashboard"),
      config: z.string().describe("The complete BI configuration JSON object as a string (must be valid JSON matching the BI config schema)"),
    }) as any,
    execute: async ({ title, config }: { title: string; config: string }) => {
      // Parse and validate config
      let configObj: any;
      try {
        configObj = typeof config === 'string' ? JSON.parse(config) : config;
      } catch (e) {
        throw new Error("Config must be valid JSON");
      }
      const validatedConfig = biConfigSchema.parse(configObj);
      try {
        // Store query results if we have them
        let queryId: string | null = null;
        const { storeQueryResult, getStoredQueryData, getCurrentRequestUserId } = await import("@/lib/bi/query-store");
        
        // Try to get stored query data (set by API route)
        const queryData = getStoredQueryData();
        if (queryData) {
          queryId = crypto.randomUUID();
          storeQueryResult(queryId, queryData);
        }

        // Get userId from request context
        const userId = getCurrentRequestUserId();

        // Replace placeholder queryId in dataSource URLs
        const updatedConfig = {
          ...validatedConfig,
          widgets: validatedConfig.widgets.map((widget: any) => ({
            ...widget,
            dataSource: {
              type: "api" as const,
              url: widget.dataSource?.url?.replace("QUERY_ID_PLACEHOLDER", queryId || "unknown") || `/api/bi/data/${queryId || "unknown"}`,
            },
          })),
        };

        const biDashboard = await (prisma as any).bIDashboard.create({
          data: {
            title,
            config: JSON.stringify(updatedConfig),
            userId: userId || null,
          },
        });

        return JSON.stringify({
          success: true,
          biId: biDashboard.id,
          message: `BI dashboard saved successfully with ID: ${biDashboard.id}. The dashboard is now available at /bi/${biDashboard.id}`,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to save BI config: ${errorMessage}`);
      }
    },
  }),
} satisfies ToolSet;

export type BITools = typeof biTools;

