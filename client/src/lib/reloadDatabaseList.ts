import { getSessionHeaders } from "@/lib/sessionHeaders";
import { queryClient } from "@/lib/queryClient";

/** Re-scan database configs from disk, then refresh the shared list query. */
export async function reloadDatabaseList(): Promise<{ count: number }> {
  const res = await fetch("/api/databases/reload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getSessionHeaders(),
    },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
  if (!res.ok) {
    throw new Error(body.error || `Failed to reload databases (${res.status})`);
  }
  await queryClient.invalidateQueries({ queryKey: ["/api/databases"] });
  return { count: typeof body.count === "number" ? body.count : 0 };
}
