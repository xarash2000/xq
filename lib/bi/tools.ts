import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { biConfigSchema } from "@/lib/types/bi";
import { prisma } from "@/lib/db";

export const biTools = {
  saveBIConfig: tool({
    description: "Save a BI dashboard configuration to the database. Call this after you have retrieved data and generated a BI config. This will create a new BI dashboard that can be viewed later.",
    inputSchema: z.object({
      title: z.string().describe("Title for the BI dashboard"),
      config: biConfigSchema.describe("The complete BI configuration JSON object"),
    }),
    execute: async ({ title, config }) => {
      try {
        // Store the query data first (we'll need to handle this differently)
        // For now, we'll store the config and the data will be fetched when needed
        const biDashboard = await prisma.bIDashboard.create({
          data: {
            title,
            config: JSON.stringify(config),
            userId: null, // Will be set by the API route
          },
        });

        return JSON.stringify({
          success: true,
          biId: biDashboard.id,
          message: `BI dashboard saved successfully with ID: ${biDashboard.id}`,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to save BI config: ${errorMessage}`);
      }
    },
  }),
  generateBIConfig: tool({
    description: "Generate a BI dashboard configuration from query results. Call this after runReadOnlySQLMssql returns data. This will create a JSON config for charts.",
    inputSchema: z.object({
      queryResults: z.string().describe("JSON string of the query results from runReadOnlySQLMssql"),
      userQuery: z.string().describe("The original user query/question"),
    }),
    execute: async ({ queryResults, userQuery }) => {
      try {
        const data = JSON.parse(queryResults);
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error("Query results must be a non-empty array");
        }

        const columns = Object.keys(data[0]);
        const sampleData = data.slice(0, 10);

        // We'll need to call the AI to generate config, but for now return a placeholder
        // The actual generation will happen in the API route
        return JSON.stringify({
          success: true,
          columns,
          rowCount: data.length,
          sampleData,
          message: "Data ready for BI config generation",
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to process query results: ${errorMessage}`);
      }
    },
  }),
} satisfies ToolSet;

export type BITools = typeof biTools;

