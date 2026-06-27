import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";

interface LocaleEntry {
  code: string;
  label: string;
}

interface LocaleSettings {
  default_locale: string;
  supported_locales: LocaleEntry[];
}

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [location, setLocation] = useLocation();

  const { data: localeSettings } = useQuery<LocaleSettings>({
    queryKey: ["/api/settings/locales"],
    queryFn: async () => {
      const res = await fetch("/api/settings/locales");
      if (!res.ok) {
        return {
          default_locale: "en",
          supported_locales: [],
        };
      }
      return res.json();
    },
    staleTime: Infinity,
  });
  const settingsLocales = localeSettings?.supported_locales ?? [];

  const { data: localeUrls } = useQuery<{ urls: Record<string, string>; contentType: string; slug: string }>({
    queryKey: ["/api/locale-urls", location],
    queryFn: async () => {
      if (!location || location === "/" || location === "/en" || location === "/es" || location === "/en/" || location === "/es/") return null;
      const res = await fetch(`/api/locale-urls?url=${encodeURIComponent(location)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!location,
    staleTime: 60000,
  });

  const availableUrls = localeUrls?.urls ?? {};

  const visibleLocales: LocaleEntry[] = (settingsLocales ?? []).filter((entry) => {
    if (!localeUrls) return true;
    return Object.prototype.hasOwnProperty.call(availableUrls, entry.code);
  });
  const maxCodeChars = Math.max(2, ...visibleLocales.map((entry) => entry.code.length));

  const currentLocaleCode = (() => {
    const match = location.split("?")[0].match(/^\/([a-z]{2}(?:-[a-z]{2})?)\//i);
    return match ? match[1].toLowerCase() : "en";
  })();

  const currentLocale = visibleLocales.find((l) => l.code === currentLocaleCode)
    ?? settingsLocales?.find((l) => l.code === currentLocaleCode)
    ?? { code: currentLocaleCode, label: currentLocaleCode.toUpperCase() };

  const changeLanguage = (code: string) => {
    const baseCode = code.split("-")[0];
    i18n.changeLanguage(baseCode);
    document.documentElement.lang = baseCode;

    if (!location || location === "/" || location === "/en/" || location === "/es/" || location === "/en" || location === "/es") {
      setLocation(`/${code}/`);
      return;
    }

    if (availableUrls[code]) {
      setLocation(availableUrls[code]);
      return;
    }

    setLocation(`/${code}/`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="button-language-switcher"
          className="gap-1 px-2"
        >
          <span className="text-xs font-semibold">{currentLocale.code.toUpperCase()}</span>
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {localeUrls !== null && localeUrls !== undefined && visibleLocales.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground" data-testid="text-no-translations">
            No translations available
          </div>
        ) : (
          visibleLocales.map((entry) => (
            <DropdownMenuItem
              key={entry.code}
              onClick={() => changeLanguage(entry.code)}
              data-testid={`menu-item-language-${entry.code}`}
              className="cursor-pointer"
            >
              <div className="w-full flex items-center gap-x-3">
                <span
                  className="shrink-0 whitespace-nowrap text-center font-medium me-1"
                  style={{ width: `${maxCodeChars}ch` }}
                >
                  {entry.code.toUpperCase()}
                </span>
                <span className="min-w-0">{entry.label}</span>
                {currentLocaleCode === entry.code && (
                  <span className="ml-auto text-primary font-bold">✓</span>
                )}
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
