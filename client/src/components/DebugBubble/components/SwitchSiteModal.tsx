import { useQuery } from "@tanstack/react-query";
import { IconSwitchHorizontal, IconServer } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SiteConfig {
  domain: string;
  contentFolder: string;
  githubRepoUrl?: string;
}

interface SwitchSiteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeDomain: string;
  isDevOverride: boolean;
}

const IS_PROD = import.meta.env.PROD;

function setDevSiteCookie(domain: string) {
  document.cookie = `__dev_site=${encodeURIComponent(domain)}; path=/; SameSite=Lax`;
}

function clearDevSiteCookie() {
  document.cookie = `__dev_site=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

export function SwitchSiteModal({ open, onOpenChange, activeDomain, isDevOverride }: SwitchSiteModalProps) {
  const { data: sites, isLoading } = useQuery<SiteConfig[]>({
    queryKey: ["/api/sites"],
    enabled: open,
    staleTime: 30000,
  });

  const handleSelect = (domain: string) => {
    if (IS_PROD) {
      const path = window.location.pathname + window.location.search;
      window.location.href = `https://${domain}${path}`;
    } else {
      setDevSiteCookie(domain);
      window.location.reload();
    }
  };

  const handleClearOverride = () => {
    clearDevSiteCookie();
    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconSwitchHorizontal className="h-4 w-4 text-muted-foreground" />
            Switch Site
          </DialogTitle>
          <DialogDescription>
            {IS_PROD
              ? "Navigates to the selected site's domain. Other visitors are unaffected."
              : "Overrides the active site for your browser session via a cookie. Only affects your browser — other visitors see their normal site."}
          </DialogDescription>
        </DialogHeader>

        {!IS_PROD && isDevOverride && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/50">
            <span className="text-xs text-muted-foreground">Dev override active</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearOverride}
              data-testid="button-clear-site-override"
            >
              Clear override
            </Button>
          </div>
        )}

        <div className="space-y-1">
          {isLoading && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">Loading sites…</span>
            </div>
          )}
          {sites?.map((site) => {
            const isActive = site.domain === activeDomain;
            return (
              <button
                key={site.domain}
                className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-left hover-elevate ${isActive ? "bg-primary/10" : ""}`}
                onClick={() => handleSelect(site.domain)}
                data-testid={`button-switch-site-${site.domain}`}
              >
                <IconServer className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-mono ${isActive ? "text-foreground font-semibold" : "text-foreground"}`}>
                      {site.domain}
                    </span>
                    {isActive && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        active
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">{site.contentFolder}</span>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
