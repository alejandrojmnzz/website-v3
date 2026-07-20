const OG_LOCALE_DEFAULTS: Record<string, string> = {
  en: "en_US",
  es: "es_ES",
};

/**
 * Converts an app locale ("en", "es", "es-mx") to the Open Graph
 * locale format ("en_US", "es_ES", "es_MX").
 */
export function toOgLocale(locale: string | undefined | null): string {
  if (!locale) return OG_LOCALE_DEFAULTS.en;

  const normalized = locale.toLowerCase().replace("_", "-");
  const [lang, region] = normalized.split("-");

  if (!/^[a-z]{2,3}$/.test(lang)) return OG_LOCALE_DEFAULTS.en;

  if (region && /^[a-z]{2}$/.test(region)) {
    return `${lang}_${region.toUpperCase()}`;
  }

  return OG_LOCALE_DEFAULTS[lang] ?? `${lang}_${lang.toUpperCase()}`;
}
