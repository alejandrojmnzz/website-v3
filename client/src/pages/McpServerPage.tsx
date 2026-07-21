import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconServer, IconCopy, IconCheck, IconChevronDown, IconChevronRight, IconSearch, IconPlug } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

interface McpParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

interface McpTool {
  name: string;
  description: string;
  parameters: McpParam[];
}

interface FetchedTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
    required?: string[];
  };
}

function toolFromFetched(t: FetchedTool): McpTool {
  const props = t.inputSchema?.properties || {};
  const required = t.inputSchema?.required || [];
  const parameters: McpParam[] = Object.entries(props).map(([name, prop]) => ({
    name,
    type: prop.type || "string",
    required: required.includes(name),
    description: prop.description || "",
    default: prop.default !== undefined ? String(prop.default) : undefined,
  }));
  return {
    name: t.name,
    description: t.description || "",
    parameters,
  };
}

function isLocalOrigin(origin: string): boolean {
  return origin.includes("localhost") || origin.includes("127.0.0.1");
}

/** Direct MCP process URL (port 3001 on local; same origin elsewhere via proxy). */
function getMcpServerUrl(): string {
  const origin = window.location.origin;
  if (isLocalOrigin(origin)) {
    return `${origin.replace(/:\d+$/, ":3001")}/mcp`;
  }
  return `${origin}/mcp`;
}

/** Prefer main-app proxied URL for cloud agents (works when MCP is behind the site). */
function getPublicConnectorUrl(): string {
  return `${window.location.origin}/mcp`;
}

function buildHttpMcpConfig(mcpUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "4geeks-cms": {
          url: mcpUrl,
        },
      },
    },
    null,
    2
  );
}

function buildClaudeDesktopConfig(mcpUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "4geeks-cms": {
          type: "http",
          url: mcpUrl,
        },
      },
    },
    null,
    2
  );
}

function buildClaudeCodeCli(mcpUrl: string): string {
  return `claude mcp add --transport http 4geeks-cms ${mcpUrl}`;
}

function CopyButton({ text, testId = "button-copy-snippet" }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={handleCopy}
      data-testid={testId}
      className="shrink-0"
    >
      {copied ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
    </Button>
  );
}

function CodeBlock({ code, testId }: { code: string; testId?: string }) {
  return (
    <div className="relative">
      <pre
        className="text-xs font-mono bg-muted px-4 py-3 rounded-md overflow-x-auto text-foreground leading-relaxed whitespace-pre-wrap break-all"
        data-testid={testId}
      >
        {code}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function SetupSteps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">{children}</ol>;
}

function ToolCard({ tool }: { tool: McpTool }) {
  const [open, setOpen] = useState(false);
  const hasParams = tool.parameters.length > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-mono font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
              {tool.name}
            </code>
            {tool.parameters.filter((p) => p.required).length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {tool.parameters.filter((p) => p.required).length} required param
                {tool.parameters.filter((p) => p.required).length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            {tool.description}
          </p>
        </div>
      </div>

      {hasParams && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 gap-1.5 text-muted-foreground"
              data-testid={`button-toggle-params-${tool.name}`}
            >
              {open ? (
                <IconChevronDown className="w-3.5 h-3.5" />
              ) : (
                <IconChevronRight className="w-3.5 h-3.5" />
              )}
              Parameters ({tool.parameters.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Req.</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tool.parameters.map((param, i) => (
                    <tr
                      key={param.name}
                      className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
                    >
                      <td className="px-3 py-2 font-mono font-medium">{param.name}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{param.type}</td>
                      <td className="px-3 py-2">
                        {param.required ? (
                          <span className="text-foreground font-semibold">yes</span>
                        ) : (
                          <span className="text-muted-foreground">no</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {param.description}
                        {param.default !== undefined && (
                          <span className="ml-1 text-muted-foreground/60">
                            (default: <code className="font-mono">{param.default}</code>)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

export default function McpServerPage() {
  const [search, setSearch] = useState("");
  const mcpUrl = getMcpServerUrl();
  const publicUrl = getPublicConnectorUrl();
  const localDev = isLocalOrigin(window.location.origin);
  const httpMcpConfig = buildHttpMcpConfig(mcpUrl);
  const claudeDesktopConfig = buildClaudeDesktopConfig(mcpUrl);
  const claudeCodeCli = buildClaudeCodeCli(mcpUrl);

  const { data, isLoading, isError } = useQuery<{ tools: FetchedTool[]; siteUrl?: string | null }>({
    queryKey: ["/api/mcp/tools"],
    staleTime: 60_000,
  });

  const { data: siteInfo } = useQuery<{ domain?: string }>({
    queryKey: ["/api/site/info"],
    staleTime: 60_000,
  });

  const allTools = useMemo<McpTool[]>(
    () => (data?.tools ?? []).map(toolFromFetched),
    [data]
  );

  /** Public connector URL for cloud agents — SITE_URL, else site domain, else current origin. */
  const cloudConnectorUrl = useMemo(() => {
    const fromEnv = data?.siteUrl?.replace(/\/$/, "");
    if (fromEnv) return `${fromEnv}/mcp`;
    const domain = siteInfo?.domain?.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (domain && !domain.includes("localhost") && !domain.includes("127.0.0.1")) {
      return `https://${domain}/mcp`;
    }
    if (!localDev) return publicUrl;
    return null;
  }, [data?.siteUrl, siteInfo?.domain, localDev, publicUrl]);

  const query = search.trim().toLowerCase();
  const filteredTools = useMemo(
    () =>
      allTools.filter(
        (tool) =>
          !query ||
          tool.name.toLowerCase().includes(query) ||
          tool.description.toLowerCase().includes(query)
      ),
    [allTools, query]
  );

  return (
    <ScrollArea className="h-screen">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-muted shrink-0">
            <IconServer className="w-6 h-6 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">MCP Server</h1>
            <p className="mt-1 text-muted-foreground">
              Connect any MCP-compatible AI agent to read and modify this website&apos;s content
              directly.
            </p>
          </div>
        </div>

        {/* Getting started */}
        <section className="space-y-5">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <IconPlug className="w-5 h-5 shrink-0" />
            Getting started
          </h2>

          <p className="text-sm text-muted-foreground leading-relaxed">
            This MCP server exposes the site&apos;s content system to AI agents via the{" "}
            <span className="font-medium text-foreground">Model Context Protocol</span>. An agent can
            list pages, read and update sections, manage SEO metadata, browse the component registry,
            and inspect its own permissions — all without leaving its chat interface.
          </p>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Server URL</p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap"
                data-testid="text-mcp-server-url"
              >
                {mcpUrl}
              </code>
              <CopyButton text={mcpUrl} testId="button-copy-mcp-url" />
            </div>
            <p className="text-xs text-muted-foreground">
              Auth is <span className="text-foreground font-medium">OAuth 2.0</span> — agents that
              support MCP OAuth will open a browser consent flow (no token in your config). You
              verify identity there via Breathecode login or by pasting a token once. Capabilities
              stay scoped to your roles. A Breathecode{" "}
              <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">Authorization</code>{" "}
              / <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">X-Api-Key</code>{" "}
              header is still accepted as a legacy fallback (e.g. curl).
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Setup by agent</p>
            <Tabs defaultValue="cursor" data-testid="tabs-mcp-agent-setup">
              <TabsList className="h-auto flex-wrap justify-start gap-1 w-full">
                <TabsTrigger value="cursor" data-testid="tab-setup-cursor">Cursor</TabsTrigger>
                <TabsTrigger value="claude-code" data-testid="tab-setup-claude-code">Claude Code</TabsTrigger>
                <TabsTrigger value="claude-desktop" data-testid="tab-setup-claude-desktop">Claude Desktop</TabsTrigger>
                <TabsTrigger value="claude-ai" data-testid="tab-setup-claude-ai">Claude.ai</TabsTrigger>
                <TabsTrigger value="chatgpt" data-testid="tab-setup-chatgpt">ChatGPT</TabsTrigger>
                <TabsTrigger value="grok" data-testid="tab-setup-grok">Grok</TabsTrigger>
              </TabsList>

              <TabsContent value="cursor" className="space-y-4 mt-4">
                <SetupSteps>
                  <li>
                    Open <span className="text-foreground font-medium">Cursor Settings → MCP</span>{" "}
                    (or edit <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">.cursor/mcp.json</code>).
                  </li>
                  <li>Add this server entry (URL only — OAuth handles login):</li>
                </SetupSteps>
                <CodeBlock code={httpMcpConfig} testId="text-mcp-config-cursor" />
                <p className="text-xs text-muted-foreground">
                  Cursor should open the OAuth consent page on first connect. Approve access, then reload MCP if
                  tools do not appear. For local use, keep{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">tsx mcp-server/index.ts</code>{" "}
                  running (Replit: start the <span className="text-foreground font-medium">MCP Server</span> workflow).
                </p>
              </TabsContent>

              <TabsContent value="claude-code" className="space-y-4 mt-4">
                <SetupSteps>
                  <li>In a terminal with the Claude Code CLI installed, add the HTTP MCP server:</li>
                </SetupSteps>
                <CodeBlock code={claudeCodeCli} testId="text-mcp-config-claude-code" />
                <p className="text-xs text-muted-foreground">
                  Complete the OAuth browser flow when prompted. Or place this JSON under your Claude Code MCP config
                  / project <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">.mcp.json</code>, then
                  restart the session.
                </p>
                <CodeBlock code={httpMcpConfig} testId="text-mcp-config-claude-code-json" />
              </TabsContent>

              <TabsContent value="claude-desktop" className="space-y-4 mt-4">
                <SetupSteps>
                  <li>
                    Edit{" "}
                    <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                      ~/Library/Application Support/Claude/claude_desktop_config.json
                    </code>{" "}
                    (macOS) or the Windows equivalent under{" "}
                    <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">%APPDATA%\Claude\</code>.
                  </li>
                  <li>Merge this config, then fully quit and reopen Claude Desktop:</li>
                </SetupSteps>
                <CodeBlock code={claudeDesktopConfig} testId="text-mcp-config-claude-desktop" />
                <p className="text-xs text-muted-foreground">
                  Claude Desktop will use OAuth against this server — no API key in the JSON. Approve the consent page
                  when it opens.
                </p>
              </TabsContent>

              <TabsContent value="claude-ai" className="space-y-4 mt-4">
                <SetupSteps>
                  <li>
                    Claude.ai needs a <span className="text-foreground font-medium">public</span> URL (not localhost).
                    Deploy the site and set <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">SITE_URL</code>{" "}
                    / <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">PUBLIC_URL</code> to that origin.
                  </li>
                  <li>
                    Go to <span className="text-foreground font-medium">Claude.ai → Settings → Connectors</span> and
                    click <span className="text-foreground font-medium">+</span>.
                  </li>
                  <li>Paste this connector URL (no token — OAuth registers the client):</li>
                </SetupSteps>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap">
                    {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
                  </code>
                  {cloudConnectorUrl && <CopyButton text={cloudConnectorUrl} testId="button-copy-claude-ai-url" />}
                </div>
                {!cloudConnectorUrl && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Set <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">SITE_URL</code> in your
                    environment so cloud agents can reach this MCP server.
                  </p>
                )}
                {cloudConnectorUrl && localDev && (
                  <p className="text-xs text-muted-foreground">
                    Using your configured site URL for the connector (Claude.ai cannot use localhost).
                  </p>
                )}
                <SetupSteps>
                  <li>Approve access on the consent page when prompted.</li>
                  <li>Use the connector from the <span className="text-foreground font-medium">+</span> button in a chat.</li>
                </SetupSteps>
              </TabsContent>

              <TabsContent value="chatgpt" className="space-y-4 mt-4">
                <SetupSteps>
                  <li>
                    ChatGPT needs a <span className="text-foreground font-medium">public</span> MCP endpoint (same as
                    Claude.ai). Deploy the site first if you are on localhost.
                  </li>
                  <li>
                    In ChatGPT, open{" "}
                    <span className="text-foreground font-medium">Settings → Connectors</span> (or Apps / Developer
                    mode, depending on your plan) and add a custom MCP / connector.
                  </li>
                  <li>Use this server URL and complete OAuth when ChatGPT prompts you:</li>
                </SetupSteps>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md text-foreground overflow-x-auto whitespace-nowrap">
                    {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
                  </code>
                  {cloudConnectorUrl && <CopyButton text={cloudConnectorUrl} testId="button-copy-chatgpt-url" />}
                </div>
                <p className="text-xs text-muted-foreground">
                  Availability depends on your ChatGPT plan and whether remote MCP connectors are enabled for your
                  workspace.
                </p>
              </TabsContent>

              <TabsContent value="grok" className="space-y-4 mt-4">
                <SetupSteps>
                  <li>
                    Grok / xAI MCP support varies by product surface. Prefer a{" "}
                    <span className="text-foreground font-medium">public</span>{" "}
                    <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">/mcp</code> URL when connecting
                    from the cloud.
                  </li>
                  <li>If the client accepts an HTTP MCP config (similar to Cursor), use URL-only OAuth config:</li>
                </SetupSteps>
                <CodeBlock code={httpMcpConfig} testId="text-mcp-config-grok" />
                <p className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
                  Connector URL for cloud UIs:{" "}
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {cloudConnectorUrl || "Set SITE_URL to your public site origin"}
                  </code>
                  {cloudConnectorUrl && <CopyButton text={cloudConnectorUrl} testId="button-copy-grok-url" />}
                </p>
                <p className="text-xs text-muted-foreground">
                  Complete OAuth in the browser when prompted. If Grok only supports local stdio MCP today, use Cursor
                  / Claude Code against this HTTP server instead.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {/* Tools list */}
        <section className="space-y-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-semibold text-foreground">
              Available tools
              {!isLoading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({allTools.length} total)
                </span>
              )}
            </h2>
            <div className="relative w-64">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search tools…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-search-tools"
                disabled={isLoading}
              />
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading tools from MCP server…</span>
            </div>
          )}

          {isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive space-y-2">
              <p>Could not reach the MCP server. Make sure it is running on port 3001.</p>
              {(typeof window !== "undefined" &&
                (window.location.hostname === "localhost" ||
                  window.location.hostname === "127.0.0.1" ||
                  import.meta.env.DEV)) && (
                <div className="text-destructive/90 space-y-1.5">
                  <p>
                    On localhost / development, start the MCP process in a separate terminal (same command as the Replit{" "}
                    <span className="font-medium">MCP Server</span> workflow):
                  </p>
                  <code className="block font-mono text-xs bg-destructive/10 px-2.5 py-1.5 rounded text-destructive">
                    tsx mcp-server/index.ts
                  </code>
                  <p className="text-xs">
                    Keep it running, then reload this page. It listens on port 3001 by default (or{" "}
                    <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">MCP_PORT</code>
                    ). The main app proxies{" "}
                    <code className="font-mono text-[11px] bg-destructive/10 px-1 py-0.5 rounded">/mcp</code> to that
                    process.
                  </p>
                </div>
              )}
            </div>
          )}

          {!isLoading && !isError && filteredTools.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {query ? "No tools match your search." : "No tools found."}
            </p>
          )}

          {!isLoading && !isError && (
            <div className="space-y-2">
              {filteredTools.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
