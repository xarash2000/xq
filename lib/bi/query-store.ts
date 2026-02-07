// In-memory store for query results (in production, use Redis or database)
const queryResultsStore = new Map<string, { data: any[]; timestamp: number }>();

// Clean up old entries (older than 1 hour)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, value] of queryResultsStore.entries()) {
      if (value.timestamp < oneHourAgo) {
        queryResultsStore.delete(key);
      }
    }
  }, 60 * 60 * 1000);
}

export function storeQueryResult(queryId: string, data: any[]): void {
  queryResultsStore.set(queryId, { data, timestamp: Date.now() });
}

export function getQueryResult(queryId: string): any[] | null {
  const stored = queryResultsStore.get(queryId);
  if (!stored) return null;
  return stored.data;
}

