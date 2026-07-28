import { useState, useEffect } from "react";
import {
  IconArrowLeft,
  IconBraces,
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCircleX,
  IconCode,
  IconDeviceFloppy,
  IconInfoCircle,
  IconLoader2,
  IconPlugConnected,
  IconServer,
  IconSettingsCog,
  IconTargetArrow,
  IconToggleLeft,
  IconToggleRight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import JsonViewer from "@/components/editing/JsonViewer";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getGtmWebStatus, type GtmWebStatus } from "@/lib/gtm-web";
import { apiRequest, apiFetch, queryClient } from "@/lib/queryClient";
import { TRACKING_EVENTS } from "@/lib/tracking";

interface TagManagerConfig {
  web_container_id: string;
  sgtm_enabled: boolean;
  sgtm_server_url: string;
  sgtm_proxy_path: string;
}

interface OptimizationConfig {
  tagmanager: TagManagerConfig;
}

function WebContainerSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<GtmWebStatus>(() => getGtmWebStatus());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data, isLoading } = useQuery<OptimizationConfig>({
    queryKey: ["/api/settings/optimization"],
  });

  const [webContainerId, setWebContainerId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.tagmanager) {
      setWebContainerId(data.tagmanager.web_container_id || "");
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    setStatus(getGtmWebStatus());

    const interval = window.setInterval(() => {
      const next = getGtmWebStatus();
      setStatus(next);
      if (next.scriptLoaded) {
        window.clearInterval(interval);
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/optimization", {
        tagmanager: {
          web_container_id: webContainerId.trim(),
        },
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/optimization"] });
      setDirty(false);
      toast({
        title: "Web container ID saved",
        description: "Reload the page for the new ID to appear in the HTML shell.",
      });
    } catch (err: any) {
      toast({
        title: "Failed to save",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="card-gtm-web-container">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <IconCode className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Web Container</CardTitle>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {status.valid ? (
            <Badge
              variant="outline"
              className="gap-1.5 text-sm px-3 py-1 text-green-700 dark:text-green-400 border-green-500/40 bg-green-500/10"
              data-testid="badge-gtm-web-configured"
            >
              <IconCircleCheck className="h-4 w-4" />
              Correctly Configured
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1.5 text-sm px-3 py-1 text-destructive border-destructive/40 bg-destructive/10"
              data-testid="badge-gtm-web-error"
            >
              <IconCircleX className="h-4 w-4" />
              Configuration Error
            </Badge>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving || isLoading}
            data-testid="button-save-web-container"
          >
            {saving ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="gtm-web-container-id"
              >
                Tag ID
              </label>
              <Input
                id="gtm-web-container-id"
                placeholder="GTM-XXXXXXX"
                value={webContainerId}
                onChange={(e) => {
                  setWebContainerId(e.target.value);
                  setDirty(true);
                }}
                className="font-mono text-sm max-w-sm"
                data-testid="input-gtm-web-container-id"
              />
              <p className="text-xs text-muted-foreground">
                Active in this page shell:{" "}
                <code className="font-mono" data-testid="text-gtm-web-container-id">
                  {status.containerId || "(not set)"}
                </code>
                {status.containerId &&
                  webContainerId.trim() &&
                  status.containerId !== webContainerId.trim() && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" "}
                      — reload after save to apply
                    </span>
                  )}
              </p>
            </div>

            {!status.valid && status.issues.length > 0 && (
              <div
                className="flex items-start gap-1.5 text-xs text-destructive"
                data-testid="status-gtm-web-issues"
              >
                <IconCircleX className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{status.issues[0]}</span>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <IconInfoCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                How it works
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Stored in{" "}
                <code className="font-mono text-xs">settings.yml</code> as{" "}
                <code className="font-mono text-xs">
                  optimization.tagmanager.web_container_id
                </code>{" "}
                and injected into the HTML shell on each request (no client API wait). Separate
                from the server-side (sGTM) proxy in the card below. Deferred load timing is
                unchanged.
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
                <li>
                  Early <code className="font-mono text-xs">window.dataLayer</code> init in{" "}
                  <code className="font-mono text-xs">&lt;head&gt;</code> so events queue before
                  GTM loads.
                </li>
                <li>
                  Deferred <code className="font-mono text-xs">gtm.js</code> on first interaction (
                  <code className="font-mono text-xs">pointerdown</code> /{" "}
                  <code className="font-mono text-xs">keydown</code> /{" "}
                  <code className="font-mono text-xs">scroll</code> /{" "}
                  <code className="font-mono text-xs">touchstart</code>) or after a 15s fallback —
                  keeps GTM out of Lighthouse&apos;s main trace.
                </li>
                <li>
                  Noscript iframe in <code className="font-mono text-xs">&lt;body&gt;</code> for
                  browsers with JavaScript disabled.
                </li>
              </ul>
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-gtm-web-script-status"
              >
                Script:{" "}
                {status.scriptLoaded
                  ? "loaded"
                  : "waiting (loads on first interaction or after 15s)"}
              </p>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-gtm-web-advanced"
              >
                {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
                <IconChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                />
              </button>
              {showAdvanced && (
                <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
                  <p>
                    Settings:{" "}
                    <code className="font-mono">
                      settings.yml → optimization.tagmanager.web_container_id
                    </code>
                  </p>
                  <p>
                    HTML placeholder + inject:{" "}
                    <code className="font-mono">client/index.html</code>,{" "}
                    <code className="font-mono">server/gtm-web-inject.ts</code>
                  </p>
                  <p>
                    Status helper: <code className="font-mono">client/src/lib/gtm-web.ts</code>
                  </p>
                  <p>
                    App events push to dataLayer via{" "}
                    <code className="font-mono">client/src/lib/tracking.ts</code>
                  </p>
                  <p>
                    Operator guide:{" "}
                    <code className="font-mono">docs/gtm-analytics-setup.md</code>
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GTMSection() {
  const { toast } = useToast();
  const [showInstructions, setShowInstructions] = useState(false);

  const { data, isLoading } = useQuery<OptimizationConfig>({
    queryKey: ["/api/settings/optimization"],
  });

  const [enabled, setEnabled] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [proxyPath, setProxyPath] = useState("/sgtm/");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  type TestStatus = "idle" | "testing" | "success" | "error";
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testReason, setTestReason] = useState<string>("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data?.tagmanager) {
      setEnabled(data.tagmanager.sgtm_enabled);
      setServerUrl(data.tagmanager.sgtm_server_url || "");
      setProxyPath(data.tagmanager.sgtm_proxy_path || "/sgtm/");
      setDirty(false);
    }
  }, [data]);

  function markDirty() {
    setDirty(true);
  }

  async function handleTestConnection() {
    if (!serverUrl.trim()) return;
    setTesting(true);
    setTestStatus("testing");
    setTestReason("");
    try {
      const res = await apiFetch("/api/settings/optimization/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: serverUrl.trim() }),
        credentials: "include",
      });
      const result = await res.json();
      if (result.reachable) {
        setTestStatus("success");
        setTestReason("");
      } else {
        setTestStatus("error");
        setTestReason(result.reason || "Server unreachable.");
      }
    } catch (err: any) {
      setTestStatus("error");
      setTestReason(err.message || "Connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  const siteOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const computedTransportUrl = `${siteOrigin}${proxyPath}`;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/optimization", {
        tagmanager: {
          sgtm_enabled: enabled,
          sgtm_server_url: serverUrl.trim(),
          sgtm_proxy_path: proxyPath.trim(),
        },
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/optimization"] });
      setDirty(false);
      toast({ title: "Optimization settings saved" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <WebContainerSection />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconSettingsCog className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Server-Side Tagging</CardTitle>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            data-testid="button-save-optimization"
          >
            {saving ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
            )}
            Save
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium">What is server-side tagging?</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Server-side Google Tag Manager (sGTM) runs your analytics tags on the server instead of the browser. This improves data quality by bypassing ad blockers and browser privacy restrictions (ITP/ETP), reduces page load time, and gives you full control over the data sent to third parties.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  When enabled, this server transparently forwards all requests matching the proxy path to your sGTM server (e.g. a Stape.io endpoint), making them appear as first-party requests from your own domain.
                </p>
              </div>

              <div className="pt-2 border-t space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Enable sGTM proxy</p>
                    <p className="text-xs text-muted-foreground">
                      When off, the proxy path returns 404 and has no performance impact.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setEnabled((v) => !v); markDirty(); }}
                    className="shrink-0 text-muted-foreground"
                    data-testid="toggle-sgtm-enabled"
                    aria-label={enabled ? "Disable sGTM proxy" : "Enable sGTM proxy"}
                  >
                    {enabled ? (
                      <IconToggleRight className="h-8 w-8 text-primary" />
                    ) : (
                      <IconToggleLeft className="h-8 w-8" />
                    )}
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="sgtm-server-url">
                    sGTM Server URL
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="sgtm-server-url"
                      placeholder="https://xxx.stape.net"
                      value={serverUrl}
                      onChange={(e) => {
                        setServerUrl(e.target.value);
                        markDirty();
                        setTestStatus("idle");
                        setTestReason("");
                      }}
                      className="font-mono text-sm"
                      data-testid="input-sgtm-server-url"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={!serverUrl.trim() || testing}
                      data-testid="button-test-sgtm-connection"
                      className="shrink-0"
                    >
                      {testing ? (
                        <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <IconPlugConnected className="h-4 w-4 mr-1.5" />
                      )}
                      Test
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The Stape.io or custom sGTM server endpoint (e.g. <code className="font-mono">https://xxx.stape.net</code>).
                  </p>
                  {testStatus === "success" && (
                    <div className="flex items-center gap-1.5 text-xs" data-testid="status-sgtm-connection-success">
                      <IconCircleCheck className="h-4 w-4 text-green-600 shrink-0" />
                      <span className="text-green-700 dark:text-green-400">Server reachable — connection successful.</span>
                    </div>
                  )}
                  {testStatus === "error" && (
                    <div className="flex items-start gap-1.5 text-xs" data-testid="status-sgtm-connection-error">
                      <IconCircleX className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <span className="text-destructive">{testReason}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="sgtm-proxy-path">
                    Proxy path
                  </label>
                  <Input
                    id="sgtm-proxy-path"
                    placeholder="/sgtm/"
                    value={proxyPath}
                    onChange={(e) => { setProxyPath(e.target.value); markDirty(); }}
                    className="font-mono text-sm"
                    data-testid="input-sgtm-proxy-path"
                  />
                  <p className="text-xs text-muted-foreground">
                    Local path to mount the proxy at. Must start with <code className="font-mono">/</code>. Default: <code className="font-mono">/sgtm/</code>.
                  </p>
                </div>

                {serverUrl && proxyPath && (
                  <div className="rounded-md border bg-muted px-3 py-2.5 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Computed transport URL</p>
                    <code className="text-xs font-mono break-all" data-testid="text-transport-url">
                      {computedTransportUrl}
                    </code>
                    <p className="text-xs text-muted-foreground">
                      Paste this URL as the transport URL in your GTM web container server transport settings.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between gap-2 pb-3 cursor-pointer"
          onClick={() => setShowInstructions((v) => !v)}
          data-testid="button-toggle-instructions"
        >
          <div className="flex items-center gap-2">
            <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">How to connect GTM</CardTitle>
          </div>
          {showInstructions ? (
            <IconChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CardHeader>
        {showInstructions && (
          <CardContent className="space-y-3 pt-0">
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                <span className="text-foreground font-medium">Create a server-side GTM container</span> in your Google Tag Manager account (Container type: <em>Server</em>).
              </li>
              <li>
                <span className="text-foreground font-medium">Provision an sGTM server</span> — use Stape.io, GCP, or any supported host. Copy the tagging server URL (e.g. <code className="font-mono text-xs">https://xxx.stape.net</code>).
              </li>
              <li>
                <span className="text-foreground font-medium">Configure the proxy above</span> — paste your sGTM server URL, choose a proxy path (default <code className="font-mono text-xs">/sgtm/</code>), enable the proxy, and save.
              </li>
              <li>
                <span className="text-foreground font-medium">Set the transport URL in GTM</span> — in your GTM <em>web</em> container, open the Google Tag / GA4 tag settings and set the <strong>Server container URL</strong> (transport URL) to:
                <div className="mt-1.5 rounded-md border bg-muted px-3 py-2">
                  <code className="text-xs font-mono break-all">{computedTransportUrl || `${siteOrigin}/sgtm/`}</code>
                </div>
              </li>
              <li>
                <span className="text-foreground font-medium">Publish both containers</span> — publish your server container first, then republish your web container. Tags will now fire through the first-party proxy.
              </li>
            </ol>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

const SAMPLE_USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface TrackingEvent {
  name: string;
  trigger: string;
  payload: Record<string, unknown>;
}

interface EventGroup {
  title: string;
  description: string;
  events: TrackingEvent[];
}

const GENERAL_EVENT_PAYLOADS: Record<string, Record<string, unknown>> = {
  page_view: {
    event: "page_view",
    user_id: SAMPLE_USER_ID,
    pagePath: "/en/apply",
    pageTitle: "Apply Now – 4Geeks Academy",
  },
  experiment_exposure: {
    event: "experiment_exposure",
    user_id: SAMPLE_USER_ID,
    experiment_id: "hero-variant-test",
    variant: "B",
  },
  cta_click: {
    event: "cta_click",
    user_id: SAMPLE_USER_ID,
    label: "Apply Now",
    section: "hero",
    destination: "/en/apply",
  },
  video_play: {
    event: "video_play",
    user_id: SAMPLE_USER_ID,
    video_id: "dQw4w9WgXcQ",
    title: "Why 4Geeks Academy",
  },
  scroll_depth: {
    event: "scroll_depth",
    user_id: SAMPLE_USER_ID,
    depth: 50,
    page: "/en/apply",
  },
};

interface UsageEntry {
  file: string;
  content_type: string;
  slug: string;
  locale: string;
  section_id: string;
  section_type: string;
  tags?: string[];
  consent?: Record<string, unknown>;
}

function EventsSection() {
  const [selectedEvent, setSelectedEvent] = useState<TrackingEvent | null>(null);

  const routeEvents: TrackingEvent[] = [
    {
      name: "website-route-change",
      trigger: "Client-side navigation (not first load)",
      payload: {
        event: "website-route-change",
        pagePath: "/en/apply",
        pageTitle: "Apply Now – 4Geeks Academy",
      },
    },
  ];

  const visitorContextEvents: TrackingEvent[] = [
    {
      name: "visitor context object",
      trigger: "Once on first load, after geo + user ID resolve",
      payload: {
        user_id: SAMPLE_USER_ID,
        visitor_location_city: "Miami",
        visitor_location_country: "United States",
        visitor_location_slug: "miami-usa",
        visitor_language: "en",
        visitor_latitude: 25.7701,
        visitor_longitude: -80.1928,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "bootcamp-2024",
      },
    },
  ];

  const generalEvents: TrackingEvent[] = TRACKING_EVENTS.map((name) => ({
    name,
    trigger: "Various interactions",
    payload: GENERAL_EVENT_PAYLOADS[name] ?? { event: name, user_id: SAMPLE_USER_ID },
  }));

  const groups: EventGroup[] = [
    {
      title: "Route Events",
      description: "Fired by usePageTracking on every client-side navigation.",
      events: routeEvents,
    },
    {
      title: "Visitor Context",
      description: "Pushed to dataLayer once per page load via setVisitorContext, after the background session worker resolves geo location and user ID.",
      events: visitorContextEvents,
    },
    {
      title: "General Events",
      description: "Fired via track for page views, clicks, video plays, and other interactions. Defined in TRACKING_EVENTS.",
      events: generalEvents,
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <Card data-testid="card-conversions-notice">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">Conversion Events</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Conversion events are now managed in the Conversions dashboard — add, rename,
                  delete, and reassign form entries all in one place.
                </p>
              </div>
              <Link href="/private/store/conversions">
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  data-testid="link-go-to-conversions"
                >
                  <IconTargetArrow className="h-3.5 w-3.5" />
                  Open Conversions dashboard
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>

        {groups.map((group) => (
          <Card key={group.title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{group.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{group.description}</p>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid={`table-events-${group.title.toLowerCase().replace(/\s+/g, "-")}`}>
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground w-2/5">Event / Push</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Trigger</th>
                      <th className="py-2 text-xs font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.events.map((ev) => (
                      <tr key={ev.name} className="border-b last:border-0">
                        <td className="py-2 pr-4 align-middle">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {ev.name}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 align-middle text-muted-foreground text-xs">{ev.trigger}</td>
                        <td className="py-2 align-middle text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSelectedEvent(ev)}
                                data-testid={`button-show-payload-${ev.name}`}
                              >
                                <IconBraces className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Show payload</TooltipContent>
                          </Tooltip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!selectedEvent} onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm font-semibold">
              {selectedEvent?.name}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Every time <code className="font-mono text-xs">{selectedEvent?.name}</code> happens, the following payload gets sent to Google Tag Manager.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-md" data-testid="text-payload-json">
            <JsonViewer
              value={selectedEvent ? JSON.stringify(selectedEvent.payload, null, 2) : ""}
              className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-x-auto"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


export default function TrackingPage() {
  const [location] = useLocation();
  const isSgtm = location === "/private/tracking/sgtm";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/private/diagnostics">
              <Button variant="ghost" size="icon" data-testid="button-back-tracking">
                <IconArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <IconChartBar className="h-6 w-6 text-muted-foreground" />
              <div>
                <h1 className="text-xl font-semibold" data-testid="text-tracking-title">Tracking</h1>
                <p className="text-sm text-muted-foreground">Analytics &amp; event configuration</p>
              </div>
            </div>
          </div>

          <div className="flex items-center rounded-md border overflow-hidden" data-testid="toggle-tracking-view">
            <Link href="/private/tracking">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  !isSgtm
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid="button-view-events"
              >
                <IconChartBar className="h-3.5 w-3.5" />
                Events
              </button>
            </Link>
            <div className="w-px h-6 bg-border" />
            <Link href="/private/tracking/sgtm">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                  isSgtm
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid="button-view-sgtm"
              >
                <IconServer className="h-3.5 w-3.5" />
                sGTM
              </button>
            </Link>
          </div>
        </div>

        {isSgtm ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Server-Side Tag Manager</h2>
            <GTMSection />
          </div>
        ) : (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Tracked Events</h2>
            <p className="text-sm text-muted-foreground">
              All events currently fired into <code className="font-mono text-xs">window.dataLayer</code>. This list is auto-generated from the source constants in <code className="font-mono text-xs">@/lib/tracking</code>.
            </p>
            <EventsSection />
          </div>
        )}
      </div>
    </div>
  );
}
