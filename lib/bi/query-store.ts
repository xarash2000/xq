// In-memory store for query results (in production, use Redis or database)
const queryResultsStore = new Map<string, { data: any[]; timestamp: number }>();

// Temporary storage for current request's query data (for tool execution)
let currentRequestQueryData: any[] | null = null;
let currentRequestUserId: string | null = null;

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

// For current request context
export function setCurrentRequestQueryData(data: any[]): void {
  currentRequestQueryData = data;
}

export function getStoredQueryData(): any[] | null {
  return currentRequestQueryData;
}

export function clearCurrentRequestQueryData(): void {
  currentRequestQueryData = null;
  currentRequestUserId = null;
}

export function setCurrentRequestUserId(userId: string): void {
  currentRequestUserId = userId;
}

export function getCurrentRequestUserId(): string | null {
  return currentRequestUserId;
}

