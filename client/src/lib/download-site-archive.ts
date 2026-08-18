import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";

type SaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableStream> }>;

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] || fallback;
}

function archiveRequestHeaders(): Record<string, string> {
  const token = getDebugToken();
  return {
    ...getSessionHeaders(),
    ...(token ? { Authorization: `Token ${token}` } : {}),
    "X-No-Compression": "1",
  };
}

async function fetchSiteArchive(): Promise<Response> {
  const res = await fetch("/api/github/site-archive", {
    method: "GET",
    headers: archiveRequestHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(data.error || `Download failed (${res.status})`);
  }
  return res;
}

/** Stream the active site's content folder as a zip to disk (no GitHub). */
export async function downloadSiteArchive(): Promise<{ filename: string }> {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

  if (picker) {
    const handle = await picker({
      suggestedName: "site-backup.zip",
      types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
    });
    const writable = await handle.createWritable();
    try {
      const res = await fetchSiteArchive();
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
        "site-backup.zip",
      );
      if (!res.body) {
        await writable.close();
        throw new Error("Empty download body");
      }
      await res.body.pipeTo(writable);
      return { filename };
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        // already closed or aborted
      }
      throw err;
    }
  }

  const res = await fetchSiteArchive();
  const filename = filenameFromDisposition(
    res.headers.get("Content-Disposition"),
    "site-backup.zip",
  );
  const blob = res.body ? await new Response(res.body).blob() : await res.blob();
  triggerBlobDownload(blob, filename);
  return { filename };
}
