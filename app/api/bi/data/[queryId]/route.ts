import { getQueryResult } from "@/lib/bi/query-store";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ queryId: string }> }
) {
  try {
    const { queryId } = await params;
    const data = getQueryResult(queryId);

    if (!data) {
      return Response.json(
        { error: "Query result not found or expired" },
        { status: 404 }
      );
    }

    return Response.json(data);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Failed to retrieve data" },
      { status: 500 }
    );
  }
}

