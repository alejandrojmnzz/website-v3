import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconX, IconPlus, IconCheck, IconAlertCircle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LinkPicker } from "@/components/editing/LinkPicker";

interface SitemapEntry { loc: string; label: string; }

interface PageTargetingChipsProps {
  pages: string[];
  onChange: (pages: string[]) => void;
  portalContainer?: HTMLElement | null;
}

export function PageTargetingChips({ pages, onChange, portalContainer }: PageTargetingChipsProps) {
  const [regexInput, setRegexInput] = useState("");
  const [regexError, setRegexError] = useState<string | null>(null);
  const [regexValid, setRegexValid] = useState(false);

  const { data: enUrls = [] } = useQuery<SitemapEntry[]>({
    queryKey: ["/api/sitemap-urls", "en"],
    queryFn: async () => {
      const r = await fetch("/api/sitemap-urls?locale=en");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });
  const { data: esUrls = [] } = useQuery<SitemapEntry[]>({
    queryKey: ["/api/sitemap-urls", "es"],
    queryFn: async () => {
      const r = await fetch("/api/sitemap-urls?locale=es");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  const allPaths = useMemo(() => {
    const toPath = (url: string) => {
      try { return new URL(url).pathname; } catch { return url; }
    };
    const paths = [...enUrls, ...esUrls].map((e) => toPath(e.loc));
    return Array.from(new Set(paths));
  }, [enUrls, esUrls]);

  const matchCount = useMemo(() => {
    if (!regexValid || !regexInput.trim() || allPaths.length === 0) return null;
    try {
      const re = new RegExp(regexInput.trim());
      return allPaths.filter((p) => re.test(p)).length;
    } catch {
      return null;
    }
  }, [regexValid, regexInput, allPaths]);

  const handleRemove = (entry: string) => {
    onChange(pages.filter((p) => p !== entry));
  };

  const handlePickPage = (path: string) => {
    if (!path || pages.includes(path)) return;
    onChange([...pages, path]);
  };

  const handleRegexChange = (value: string) => {
    setRegexInput(value);
    if (!value.trim()) {
      setRegexError(null);
      setRegexValid(false);
      return;
    }
    try {
      new RegExp(value.trim());
      setRegexError(null);
      setRegexValid(true);
    } catch {
      setRegexError("Invalid regular expression");
      setRegexValid(false);
    }
  };

  const handleAddRegex = () => {
    const trimmed = regexInput.trim();
    if (!trimmed || !regexValid) return;
    if (!pages.includes(trimmed)) {
      onChange([...pages, trimmed]);
    }
    setRegexInput("");
    setRegexError(null);
    setRegexValid(false);
  };

  return (
    <div className="space-y-2">
      {pages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pages.map((entry) => (
            <span
              key={entry}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-muted text-foreground border"
              data-testid={`chip-page-${entry}`}
            >
              <span className="max-w-[200px] truncate">{entry}</span>
              <button
                type="button"
                onClick={() => handleRemove(entry)}
                className="text-muted-foreground hover-elevate rounded-sm flex-shrink-0"
                data-testid={`button-remove-page-${entry}`}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <LinkPicker
          value=""
          onChange={handlePickPage}
          allowedTypes={["internal"]}
          portalContainer={portalContainer}
          testId="page-targeting-link-picker"
        />
      </div>

      <div className="space-y-1">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Input
              value={regexInput}
              onChange={(e) => handleRegexChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddRegex(); }}
              placeholder="Add regex, e.g. ^/en/.*"
              className="h-8 text-sm pr-7"
              data-testid="input-overlay-page-regex"
            />
            {regexInput.trim() && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                {regexValid
                  ? <IconCheck size={14} className="text-primary" />
                  : <IconAlertCircle size={14} className="text-destructive" />
                }
              </span>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleAddRegex}
            disabled={!regexInput.trim() || !regexValid}
            data-testid="button-add-page-regex"
          >
            <IconPlus size={14} />
            Add
          </Button>
        </div>
        {regexError && (
          <p className="text-xs text-destructive" data-testid="text-regex-error">{regexError}</p>
        )}
        {matchCount !== null && (
          <p
            className={`text-xs ${matchCount > 0 ? "text-muted-foreground" : "text-muted-foreground/60"}`}
            data-testid="text-regex-match-count"
          >
            {matchCount > 0
              ? `Matches ${matchCount} page${matchCount === 1 ? "" : "s"}`
              : "No pages match"}
          </p>
        )}
      </div>
    </div>
  );
}
