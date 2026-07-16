import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconRobot,
  IconLoader2,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface RobotsSettingsResponse {
  block_indexing: boolean;
  include_sitemap: boolean;
  disallow_paths: string[];
  ai_bots: string[];
  robots_txt_preview?: string;
}

export function RobotsTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<RobotsSettingsResponse>({
    queryKey: ["/api/settings/robots"],
  });

  const [blockIndexing, setBlockIndexing] = useState(false);
  const [includeSitemap, setIncludeSitemap] = useState(true);
  const [disallowPaths, setDisallowPaths] = useState<string[]>([]);
  const [aiBots, setAiBots] = useState<string[]>([]);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    setBlockIndexing(data.block_indexing);
    setIncludeSitemap(data.include_sitemap);
    setDisallowPaths([...data.disallow_paths]);
    setAiBots([...data.ai_bots]);
    setPreview(data.robots_txt_preview || "");
    setDirty(false);
  }, [data]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/robots", {
        block_indexing: blockIndexing,
        include_sitemap: includeSitemap,
        disallow_paths: disallowPaths.map((p) => p.trim()).filter(Boolean),
        ai_bots: aiBots.map((b) => b.trim()).filter(Boolean),
      });
      const json = (await res.json()) as RobotsSettingsResponse;
      setPreview(json.robots_txt_preview || "");
      setDisallowPaths([...json.disallow_paths]);
      setAiBots([...json.ai_bots]);
      setBlockIndexing(json.block_indexing);
      setIncludeSitemap(json.include_sitemap);
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/robots"] });
      toast({ title: "Robots settings saved" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save robots settings";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <div className="flex items-center gap-2">
          <IconRobot className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Robots & indexing</CardTitle>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          data-testid="button-save-robots"
        >
          {saving ? (
            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
          )}
          Save
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div
              className={`rounded-md border p-4 space-y-3 ${
                blockIndexing ? "border-destructive/50 bg-destructive/5" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="block-indexing" className="text-sm font-medium">
                    Block indexing for entire site
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, robots.txt disallows all crawlers and every page serves{" "}
                    <code className="text-xs">noindex, nofollow</code>. Per-page robots settings
                    are ignored until this is turned off.
                  </p>
                </div>
                <Switch
                  id="block-indexing"
                  checked={blockIndexing}
                  onCheckedChange={(v) => {
                    setBlockIndexing(v);
                    markDirty();
                  }}
                  data-testid="switch-block-indexing"
                />
              </div>
              {blockIndexing && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    The whole website is currently disallowed from search indexing.
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div className="space-y-1">
                <Label htmlFor="include-sitemap" className="text-sm font-medium">
                  Include Sitemap in robots.txt
                </Label>
                <p className="text-xs text-muted-foreground">
                  Advertise <code className="text-xs">/sitemap.xml</code> when indexing is allowed.
                  Ignored while the site is blocked.
                </p>
              </div>
              <Switch
                id="include-sitemap"
                checked={includeSitemap}
                disabled={blockIndexing}
                onCheckedChange={(v) => {
                  setIncludeSitemap(v);
                  markDirty();
                }}
                data-testid="switch-include-sitemap"
              />
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Disallow paths</p>
                <p className="text-xs text-muted-foreground">
                  Paths listed under <code className="text-xs">User-agent: *</code> in robots.txt.
                  Stored in <code className="text-xs">settings.yml</code> as{" "}
                  <code className="text-xs">robots.disallow_paths</code>.
                </p>
              </div>
              <div className="space-y-2">
                {disallowPaths.map((path, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={path}
                      disabled={blockIndexing}
                      onChange={(e) => {
                        const next = [...disallowPaths];
                        next[index] = e.target.value;
                        setDisallowPaths(next);
                        markDirty();
                      }}
                      placeholder="/private/"
                      className="font-mono text-sm"
                      data-testid={`input-disallow-path-${index}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={blockIndexing}
                      onClick={() => {
                        setDisallowPaths(disallowPaths.filter((_, i) => i !== index));
                        markDirty();
                      }}
                      data-testid={`button-remove-disallow-${index}`}
                    >
                      <IconTrash className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={blockIndexing}
                  onClick={() => {
                    setDisallowPaths([...disallowPaths, "/"]);
                    markDirty();
                  }}
                  data-testid="button-add-disallow-path"
                >
                  <IconPlus className="h-4 w-4 mr-1.5" />
                  Add path
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">AI bot User-agents</p>
                <p className="text-xs text-muted-foreground">
                  Explicitly allowed AI/LLM crawlers when the site is indexable.
                </p>
              </div>
              <div className="space-y-2">
                {aiBots.map((bot, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={bot}
                      disabled={blockIndexing}
                      onChange={(e) => {
                        const next = [...aiBots];
                        next[index] = e.target.value;
                        setAiBots(next);
                        markDirty();
                      }}
                      placeholder="GPTBot"
                      className="font-mono text-sm"
                      data-testid={`input-ai-bot-${index}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={blockIndexing}
                      onClick={() => {
                        setAiBots(aiBots.filter((_, i) => i !== index));
                        markDirty();
                      }}
                      data-testid={`button-remove-ai-bot-${index}`}
                    >
                      <IconTrash className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={blockIndexing}
                  onClick={() => {
                    setAiBots([...aiBots, ""]);
                    markDirty();
                  }}
                  data-testid="button-add-ai-bot"
                >
                  <IconPlus className="h-4 w-4 mr-1.5" />
                  Add bot
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">robots.txt preview</p>
              <pre
                className="rounded-md border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64"
                data-testid="text-robots-preview"
              >
                {preview || "(save to refresh preview)"}
              </pre>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
