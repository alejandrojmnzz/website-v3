import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconBrandGoogle,
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconDeviceFloppy,
  IconInfoCircle,
  IconLoader2,
} from "@tabler/icons-react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { getDebugToken, useDebugAuth } from "@/hooks/useDebugAuth";
import { apiRequestWithAuth, queryClient } from "@/lib/queryClient";
import type { GscInspectionGetResponse } from "@/lib/gscInspection";
import { isGscPropertyAccessDenied } from "@/lib/gscInspection";

function configuredBadge(ok: boolean, okLabel: string, missingLabel: string, testId: string) {
  return ok ? (
    <Badge
      variant="secondary"
      className="gap-1 border-transparent bg-chart-3/15 text-chart-3"
      data-testid={testId}
    >
      <IconCircleCheck className="h-3.5 w-3.5" />
      {okLabel}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1" data-testid={testId}>
      <IconAlertCircle className="h-3.5 w-3.5" />
      {missingLabel}
    </Badge>
  );
}

function RoleNotSetBadge({ email }: { email: string | null }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="destructive"
          className="gap-1 cursor-pointer"
          data-testid="badge-gsc-credentials"
        >
          <IconAlertCircle className="h-3.5 w-3.5" />
          role not set on Search Console property
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 text-sm space-y-2"
        align="start"
        data-testid="popover-gsc-role-help"
      >
        <p className="font-medium text-foreground">What this means</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Google Search Console rejected the inspect call. The JSON key is present and Google issued a
          token; this service account is not allowed to inspect the saved property.
        </p>
        <p className="font-medium text-foreground">Usual causes</p>
        <ul className="text-muted-foreground text-xs leading-relaxed list-disc pl-4 space-y-1">
          <li>
            {email ? (
              <>
                <code className="font-mono text-[10px] break-all">{email}</code> is not a user on that
                Search Console property (Settings → Users and permissions). Needs at least Restricted
                user.
              </>
            ) : (
              <>
                The service account is not a user on that Search Console property (Settings → Users and
                permissions). Needs at least Restricted user.
              </>
            )}
          </li>
          <li>
            The saved property does not match Search Console exactly (
            <code className="font-mono text-[10px]">https://example.com/</code> vs{" "}
            <code className="font-mono text-[10px]">https://www.example.com/</code> vs{" "}
            <code className="font-mono text-[10px]">sc-domain:example.com</code>
            ). A wrong property string often comes back as the same 403.
          </li>
          <li>The Search Console API is not enabled on the GCP project that owns the key.</li>
        </ul>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Add the account, wait a minute, then Test connection again.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function RollupCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | number;
  testId: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums text-foreground mt-1" data-testid={testId}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export function SearchConsoleTab() {
  const { toast } = useToast();
  const { hasCapability, isValidated } = useDebugAuth();
  const canEdit = hasCapability("seo_edit");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [siteUrlDraft, setSiteUrlDraft] = useState("");
  const [emailCopied, setEmailCopied] = useState(false);

  const { data, isLoading } = useQuery<GscInspectionGetResponse>({
    queryKey: ["/api/debug/gsc-inspection"],
    enabled: isValidated === true,
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection", {
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load Search Console status");
      return res.json() as Promise<GscInspectionGetResponse>;
    },
  });

  useEffect(() => {
    if (!data) return;
    setSiteUrlDraft(data.siteUrl || data.suggestedSiteUrl || "");
  }, [data]);

  async function handleSaveProperty() {
    setSaving(true);
    try {
      await apiRequestWithAuth("PUT", "/api/settings/search-console", {
        site_url: siteUrlDraft.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
      toast({
        title: "Property saved",
        description: "Wrote search_console.site_url to settings.yml. Saving does not call Google.",
      });
    } catch (err: unknown) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!data?.homepageLoc) {
      toast({
        title: "No homepage URL",
        description: "Could not resolve a sitemap homepage to inspect.",
        variant: "destructive",
      });
      return;
    }
    setTesting(true);
    try {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ urls: [data.homepageLoc], force: true }),
      });
      const body = await res.json().catch(() => ({}));
      await queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
      }
      const first = Array.isArray(body.results) ? body.results[0] : null;
      if (first?.error) {
        throw new Error(first.error);
      }
      toast({
        title: "Connection ok",
        description: first?.record?.coverageState
          ? `Homepage coverage: ${first.record.coverageState}`
          : "Search Console accepted the homepage inspect.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const roleDenied = isGscPropertyAccessDenied(message);
      toast({
        title: roleDenied ? "Role not set" : "Test failed",
        description: roleDenied
          ? "Add this service account as a user on the Search Console property, then test again."
          : message,
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <IconLoader2 className="h-5 w-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  const summary = data.summary;
  const newest = summary.newestInspectedAt
    ? new Date(summary.newestInspectedAt).toLocaleString()
    : "Never";
  const savedSiteUrl = data.siteUrl || "";
  const dirty = siteUrlDraft.trim() !== savedSiteUrl;

  return (
    <div className="space-y-4" data-testid="tab-panel-search-console">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How Search Console inspection works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            This app reads Google Search Console <strong className="text-foreground font-medium">URL Inspection</strong>{" "}
            status and caches it on disk. It does <strong className="text-foreground font-medium">not</strong> request
            indexing. Checking a URL spends daily quota (~2000/day). Restarts load{" "}
            <code className="font-mono text-xs">.cache/{"{site}"}/gsc-url-inspection.json</code> only — they do not
            call Google.
          </p>
          <p>
            The Search Console property lives in this site’s{" "}
            <code className="font-mono text-xs">settings.yml</code> as{" "}
            <code className="font-mono text-xs">search_console.site_url</code> (for example{" "}
            <code className="font-mono text-xs">https://example.com/</code> or{" "}
            <code className="font-mono text-xs">sc-domain:example.com</code>). The input below is prefilled from the
            sites.yml domain; inspection does <strong className="text-foreground font-medium">not</strong> run until
            you Save. Saving YAML does not call Google.
          </p>
          <p>
            Credentials stay <strong className="text-foreground font-medium">host environment only</strong> — the same
            service account as media: <code className="font-mono text-xs">GCS_CREDENTIALS_JSON</code> or{" "}
            <code className="font-mono text-xs">GCS_KEY_FILENAME</code>. This UI never stores the key in YAML or
            GitHub. Add that account as a user on the Search Console property (otherwise Test connection reports
            “role not set”).
          </p>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0 h-auto text-xs" data-testid="button-gsc-read-more">
                Read more (advanced)
                <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-1 text-xs font-mono">
              <p>server/settings.ts</p>
              <p>server/gsc-url-inspection.ts</p>
              <p>settings.yml → search_console.site_url</p>
              <p>.cache/{"{contentRoot}"}/gsc-url-inspection.json</p>
              <p>GET/POST /api/debug/gsc-inspection</p>
              <p>PUT /api/settings/search-console</p>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <Card data-testid="card-gsc-connection">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <IconBrandGoogle className="h-4 w-4" />
              Connection
            </CardTitle>
            <Button
              size="sm"
              onClick={() => void handleTestConnection()}
              disabled={!canEdit || !data.configured || testing || !data.homepageLoc}
              data-testid="button-gsc-test-connection"
            >
              {testing ? (
                <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <IconInfoCircle className="h-4 w-4 mr-1.5" />
              )}
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Property</span>
            {configuredBadge(
              Boolean(data.siteUrl),
              data.siteUrl || "set",
              "Property not saved",
              "badge-gsc-site-url",
            )}
            <Badge variant="secondary" className="text-[10px] font-normal">
              settings.yml
            </Badge>
          </div>
          {!data.siteUrl && (
            <p className="text-xs text-muted-foreground" data-testid="text-gsc-save-hint">
              Save a property to enable inspection. The suggestion is not live until you save.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="gsc-site-url">Search Console property</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="gsc-site-url"
                className="font-mono text-xs max-w-md"
                value={siteUrlDraft}
                onChange={(e) => setSiteUrlDraft(e.target.value)}
                placeholder="https://example.com/ or sc-domain:example.com"
                disabled={!canEdit || saving}
                data-testid="input-gsc-site-url"
              />
              <Button
                size="sm"
                onClick={() => void handleSaveProperty()}
                disabled={!canEdit || saving || !dirty || !siteUrlDraft.trim()}
                data-testid="button-gsc-save-property"
              >
                {saving ? (
                  <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                )}
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Service account</span>
            {!data.credentialsConfigured
              ? configuredBadge(false, "", "GCS_CREDENTIALS_JSON missing", "badge-gsc-credentials")
              : data.propertyAccess === "denied"
                ? <RoleNotSetBadge email={data.serviceAccountEmail} />
                : configuredBadge(
                    true,
                    data.serviceAccountEmail || "present",
                    "GCS_CREDENTIALS_JSON missing",
                    "badge-gsc-credentials",
                  )}
            <Badge variant="secondary" className="text-[10px] font-normal font-mono" data-testid="badge-gsc-credentials-env">
              from env · {data.credentialsEnvVar || "GCS_CREDENTIALS_JSON"}
            </Badge>
          </div>
          {data.credentialsConfigured && data.propertyAccess === "denied" && data.serviceAccountEmail && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-gsc-sa-email">
              <span>
                This is the email you have to add into your Search Console users:{" "}
                <span className="font-mono break-all text-foreground">{data.serviceAccountEmail}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label="Copy service account email"
                data-testid="button-gsc-copy-sa-email"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.serviceAccountEmail!);
                    setEmailCopied(true);
                    window.setTimeout(() => setEmailCopied(false), 2000);
                    toast({ title: "Copied", description: "Service account email copied." });
                  } catch {
                    toast({
                      title: "Copy failed",
                      description: "Could not copy the email.",
                      variant: "destructive",
                    });
                  }
                }}
              >
                {emailCopied ? (
                  <IconCheck className="h-3.5 w-3.5 text-chart-3" />
                ) : (
                  <IconCopy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          )}
          {data.siteUrlMatch === false && (
            <p className="text-xs text-destructive" data-testid="text-gsc-host-mismatch">
              Sitemap host does not match the saved Search Console property. Inspection URLs may be rejected.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="gsc-settings-rollup">
        <RollupCard label="Checked / never" value={`${summary.inspected} / ${summary.neverChecked}`} testId="text-gsc-checked" />
        <RollupCard label="Indexed" value={summary.indexed} testId="text-gsc-indexed" />
        <RollupCard label="Not indexed" value={summary.notIndexed} testId="text-gsc-not-indexed" />
        <RollupCard label="Inspect errors" value={summary.errors} testId="text-gsc-errors" />
        <RollupCard label="In sitemap" value={summary.sitemapCount} testId="text-gsc-sitemap-count" />
        <RollupCard label="Last inspect" value={newest} testId="text-gsc-newest" />
      </div>
    </div>
  );
}
