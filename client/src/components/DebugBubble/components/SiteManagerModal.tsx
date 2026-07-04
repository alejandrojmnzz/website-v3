import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconServer } from "@tabler/icons-react";
import { Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDebugToken } from "@/hooks/useDebugAuth";

interface SiteInfo {
  domain: string;
  contentFolder: string;
  isMultiSite: boolean;
  isDevOverride: boolean;
  githubRepoUrl?: string;
}

interface SiteManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteInfo: SiteInfo | null | undefined;
}

interface CreateSiteResult {
  folderName: string;
  created: boolean;
}

function ConfigRow({ label, value, mono = false }: { label: string; value: string | boolean | undefined; mono?: boolean }) {
  if (value === undefined || value === null || value === "") return null;
  const displayValue = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0 w-32">{label}</span>
      <span className={`text-xs text-foreground text-right break-all ${mono ? "font-mono" : ""}`}>{displayValue}</span>
    </div>
  );
}

export function SiteManagerModal({ open, onOpenChange, siteInfo }: SiteManagerModalProps) {
  const [folderName, setFolderName] = useState("");
  const [domain, setDomain] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [includeSample, setIncludeSample] = useState(true);
  const [successResult, setSuccessResult] = useState<CreateSiteResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const createMutation = useMutation<CreateSiteResult, Error, { name: string; domain: string; githubRepoUrl?: string; includeSampleContent: boolean }>({
    mutationFn: async (body) => {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Token ${token}`;
      const res = await fetch("/api/admin/sites/create", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create site");
      return data as CreateSiteResult;
    },
    onSuccess: (data) => {
      setSuccessResult(data);
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ["/api/site/info"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
    },
    onError: (err) => {
      setErrorMsg(err.message);
    },
  });

  const handleCreate = () => {
    if (!folderName.trim() || !domain.trim()) return;
    setErrorMsg(null);
    setSuccessResult(null);
    createMutation.mutate({
      name: folderName.trim(),
      domain: domain.trim(),
      githubRepoUrl: githubUrl.trim() || undefined,
      includeSampleContent: includeSample,
    });
  };

  const handleDialogClose = (v: boolean) => {
    if (!v) {
      setSuccessResult(null);
      setErrorMsg(null);
    }
    onOpenChange(v);
  };

  const isSubmitDisabled = !folderName.trim() || !domain.trim() || createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconServer className="h-4 w-4 text-muted-foreground" />
            Site Manager
          </DialogTitle>
          <DialogDescription>
            View current site configuration or scaffold a new site.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="config" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="config" className="flex-1">Current Config</TabsTrigger>
            <TabsTrigger value="new" className="flex-1">New Site</TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="mt-4">
            {siteInfo ? (
              <div className="rounded-md border px-3 py-1">
                <ConfigRow label="Content Folder" value={siteInfo.contentFolder} mono />
                <ConfigRow label="Domain" value={siteInfo.domain} mono />
                <ConfigRow label="Multi-site Mode" value={siteInfo.isMultiSite} />
                <ConfigRow label="Dev Override" value={siteInfo.isDevOverride} />
                <ConfigRow label="GitHub Repo URL" value={siteInfo.githubRepoUrl} mono />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No site info available.</p>
            )}
          </TabsContent>

          <TabsContent value="new" className="mt-4 space-y-4">
            {successResult ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  Site created successfully
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Folder: <code className="font-mono bg-muted px-1 py-0.5 rounded">{successResult.folderName}/</code></p>
                  <p className="mt-2 text-foreground">Next step: restart the server for the new site to be picked up.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSuccessResult(null);
                    setFolderName("");
                    setDomain("");
                    setGithubUrl("");
                    setIncludeSample(false);
                  }}
                >
                  Create another site
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="site-folder-name" className="text-xs">
                    Site folder name
                  </Label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1.5 rounded-l border border-r-0 border-input shrink-0">site_</span>
                    <Input
                      id="site-folder-name"
                      value={folderName}
                      onChange={(e) => setFolderName(e.target.value)}
                      placeholder="my-site"
                      className="rounded-l-none font-mono text-sm"
                      data-testid="input-site-folder-name"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Alphanumeric and hyphens only. Will create folder <code className="font-mono">site_{folderName || "…"}/</code>.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="site-domain" className="text-xs">Primary domain</Label>
                  <Input
                    id="site-domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="example.com"
                    className="font-mono text-sm"
                    data-testid="input-site-domain"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="site-github-url" className="text-xs">GitHub repo URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="site-github-url"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/org/repo"
                    className="font-mono text-sm"
                    data-testid="input-site-github-url"
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <Label htmlFor="site-sample-content" className="text-xs">Include sample content</Label>
                    <p className="text-[11px] text-muted-foreground">Adds an about page and a sample blog post.</p>
                  </div>
                  <Switch
                    id="site-sample-content"
                    checked={includeSample}
                    onCheckedChange={setIncludeSample}
                    data-testid="switch-include-sample-content"
                  />
                </div>

                {errorMsg && (
                  <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{errorMsg}</p>
                )}

                <div className="flex justify-end pt-1">
                  <Button
                    onClick={handleCreate}
                    disabled={isSubmitDisabled}
                    size="sm"
                    data-testid="button-create-site"
                  >
                    {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Create Site
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
