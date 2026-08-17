/** Hostname (no protocol) for table badges; relative paths stay as-is. */
export function referrerDisplayHost(referrer: string): string {
  const trimmed = referrer.trim();
  if (!trimmed) return "";

  const hostFromUrl = (value: string): string | undefined => {
    try {
      const url = new URL(value);
      return url.port ? `${url.hostname}:${url.port}` : url.hostname;
    } catch {
      return undefined;
    }
  };

  if (/^https?:\/\//i.test(trimmed)) {
    return hostFromUrl(trimmed) ?? trimmed.replace(/^https?:\/\//i, "").split("/")[0];
  }

  if (trimmed.startsWith("/")) return trimmed;

  return hostFromUrl(`https://${trimmed}`) ?? trimmed;
}
