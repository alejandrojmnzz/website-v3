import Header from "@/components/Header";
import { useInternalNav } from "@/hooks/useInternalNav";

export type LocaleUnavailableInfo = {
  message?: string;
  locale?: string;
  available_locales?: Record<string, string>;
};

export default function LocaleUnavailable({
  info,
  pageLocale,
}: {
  info?: LocaleUnavailableInfo | null;
  pageLocale: string;
}) {
  const handleLinkClick = useInternalNav();
  const available = info?.available_locales || {};
  const entries = Object.entries(available);
  const isEs = pageLocale === "es";

  return (
    <div data-testid="locale-unavailable">
      <Header />
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-lg space-y-4">
          <h1 className="text-2xl font-bold text-foreground">
            {isEs
              ? "Contenido no disponible en este idioma"
              : "Content not available in this language"}
          </h1>
          <p className="text-muted-foreground">
            {info?.message ||
              (isEs
                ? "Esta página aún no tiene una traducción válida para este idioma."
                : "This page does not have a valid translation for this language yet.")}
          </p>
          {entries.length > 0 && (
            <div className="pt-2 space-y-2">
              <p className="text-sm text-muted-foreground">
                {isEs ? "Leer en otro idioma:" : "Read in another language:"}
              </p>
              <ul className="flex flex-wrap justify-center gap-3">
                {entries.map(([loc, url]) => (
                  <li key={loc}>
                    <a
                      href={url}
                      onClick={handleLinkClick}
                      className="text-primary hover:underline font-medium uppercase"
                      data-testid={`link-available-locale-${loc}`}
                    >
                      {loc}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
