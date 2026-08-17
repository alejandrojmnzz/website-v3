/**
 * Resolve where a redirect should point when the destination is a DB-backed
 * content type (how-to, lesson, …) with no per-slug YAML folder for meta.redirects.
 */
export function resolveDatabaseBackedRedirectDestination(opts: {
  destUrl: string;
  allLanguages: boolean;
  builtUrl: string;
  alternateUrls: Record<string, string>;
  isKnownUrl: (url: string) => boolean;
}): { ok: true; to: string | Record<string, string> } | { ok: false } {
  const known =
    opts.isKnownUrl(opts.destUrl) ||
    opts.isKnownUrl(opts.builtUrl) ||
    Object.values(opts.alternateUrls).some((u) => opts.isKnownUrl(u));

  if (!known) return { ok: false };

  if (opts.allLanguages && Object.keys(opts.alternateUrls).length > 0) {
    return {
      ok: true,
      to:
        Object.keys(opts.alternateUrls).length === 1
          ? Object.values(opts.alternateUrls)[0]
          : opts.alternateUrls,
    };
  }

  if (opts.isKnownUrl(opts.destUrl)) {
    return { ok: true, to: opts.destUrl };
  }

  return { ok: true, to: opts.builtUrl };
}
