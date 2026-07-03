import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, ChevronDown, ChevronRight, Clipboard, Code, Copy, Download, ExternalLink, Folder, History, Home, MoreVertical, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { MenuView, SitemapUrl } from "../types";
import { StatusCountBadge } from "./StatusCountBadge";

export interface SitemapFolder {
  name: string;
  path: string;
  urls: SitemapUrl[];
  subfolders: SitemapFolder[];
}

interface SitemapViewProps {
  setMenuView: (v: MenuView) => void;
  sitemapUrls: SitemapUrl[];
  sitemapLoading: boolean;
  sitemapSearch: string;
  setSitemapSearch: (v: string) => void;
  showSitemapSearch: boolean;
  setShowSitemapSearch: (v: boolean) => void;
  filteredSitemapUrls: SitemapUrl[];
  folders: SitemapFolder[];
  rootUrls: SitemapUrl[];
  expandedFolders: Set<string>;
  toggleFolder: (name: string) => void;
  setCreateContentModalOpen: (v: boolean) => void;
  handleDuplicatePage: (url: SitemapUrl) => void;
  handleDeletePage: (url: SitemapUrl) => void;
  handleDownloadYml: (url: SitemapUrl) => void;
  handleEditYaml: (url: SitemapUrl) => void;
  handleRefreshCache: (url: SitemapUrl) => void;
  validationSummary: Record<string, { errorCount: number; warningCount: number }>;
  onOpenDiagnosticsForUrl: (urlPath: string) => void;
}

function ValidationBadge({
  urlPath,
  validationSummary,
  onOpenDiagnosticsForUrl,
}: {
  urlPath: string;
  validationSummary: Record<string, { errorCount: number; warningCount: number }>;
  onOpenDiagnosticsForUrl: (urlPath: string) => void;
}) {
  const entry = validationSummary[urlPath];
  if (!entry) return null;

  return (
    <StatusCountBadge
      errorCount={entry.errorCount}
      warningCount={entry.warningCount}
      onClick={() => onOpenDiagnosticsForUrl(urlPath)}
      testId={`badge-validation-${urlPath.replace(/\//g, "-")}`}
    />
  );
}

export function SitemapView({
  setMenuView,
  sitemapUrls,
  sitemapLoading,
  sitemapSearch,
  setSitemapSearch,
  showSitemapSearch,
  setShowSitemapSearch,
  filteredSitemapUrls,
  folders,
  rootUrls,
  expandedFolders,
  toggleFolder,
  setCreateContentModalOpen,
  handleDuplicatePage,
  handleDeletePage,
  handleDownloadYml,
  handleEditYaml,
  handleRefreshCache,
  validationSummary,
  onOpenDiagnosticsForUrl,
}: SitemapViewProps) {
  const { toast } = useToast();

  const copyUrl = async (loc: string) => {
    await navigator.clipboard.writeText(loc);
    toast({ title: "Copied", description: loc, duration: 2000 });
  };

  const LOCALE_PREFIXES = new Set(["en", "es", "us"]);

  const extractSlug = (loc: string): string => {
    const parts = new URL(loc).pathname.split('/').filter(Boolean);
    const contentParts = parts.length > 0 && LOCALE_PREFIXES.has(parts[0]) ? parts.slice(1) : parts;
    return contentParts[contentParts.length - 1] || '';
  };

  const isBlogUrl = (loc: string): boolean => {
    const parts = new URL(loc).pathname.split('/').filter(Boolean);
    const hasLocale = parts[0] === 'en' || parts[0] === 'es' || parts[0] === 'us';
    const contentParts = hasLocale ? parts.slice(1) : parts;
    return contentParts[0] === 'blog';
  };

  return (
    <>
      <div className="px-3 py-2 border-b">
        <div className="flex items-center justify-between gap-2">
          {showSitemapSearch ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search URLs..."
                  value={sitemapSearch}
                  onChange={(e) => setSitemapSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-sitemap-search"
                  autoFocus
                />
              </div>
              <button
                onClick={() => { setShowSitemapSearch(false); setSitemapSearch(""); }}
                className="p-1.5 rounded hover-elevate flex-shrink-0"
                title="Cancel search"
                data-testid="button-cancel-sitemap-search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMenuView("main")}
                  className="p-1 rounded-md hover-elevate"
                  data-testid="button-back-to-main-sitemap"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div>
                  <h3 className="font-semibold text-sm">Sitemap URLs</h3>
                  <p className="text-xs text-muted-foreground">{sitemapUrls.length} URLs indexed</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCreateContentModalOpen(true)}
                  className="p-1.5 rounded hover-elevate"
                  title="Create new content"
                  data-testid="button-create-content"
                >
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                  onClick={() => setShowSitemapSearch(true)}
                  className="p-1.5 rounded hover-elevate"
                  title="Search"
                  data-testid="button-toggle-sitemap-search"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                </button>
                <a
                  href="/sitemap.xml"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded hover-elevate"
                  title="Open sitemap.xml"
                  data-testid="link-sitemap-xml"
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
              </div>
            </>
          )}
        </div>
      </div>
      
      <div className="overflow-y-auto overflow-x-hidden max-h-[240px]">
        <div className="p-2 space-y-1">
          {sitemapLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <a
                href="/en"
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left hover-elevate cursor-pointer mb-1"
                data-testid="link-sitemap-home"
              >
                <Home className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="font-medium flex-1 min-w-0 truncate">Home</span>
              </a>
              {filteredSitemapUrls.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No URLs found
                </div>
              ) : (
                <>
              {folders.map((folder) => (
                <div key={folder.name} className="mb-1">
                  <button
                    onClick={() => toggleFolder(folder.name)}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left hover-elevate cursor-pointer"
                    data-testid={`button-folder-${folder.name.toLowerCase()}`}
                  >
                    {expandedFolders.has(folder.name) ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <Folder className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="font-medium flex-1 min-w-0 truncate">{folder.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {folder.urls.length}
                    </span>
                  </button>
                  {expandedFolders.has(folder.name) && (
                    <div className="ml-4 border-l pl-2 space-y-1 mt-1">
                      {folder.urls.map((url, urlIndex) => {
                        const path = new URL(url.loc).pathname;
                        return (
                          <div
                            key={`${folder.name}-${urlIndex}-${url.loc}`}
                            className="group flex items-center gap-1 px-3 py-1 rounded-md hover-elevate"
                          >
                            <a
                              href={path}
                              className="flex-1 min-w-0 text-xs text-muted-foreground cursor-pointer truncate"
                              data-testid={`link-sitemap-url-${url.label.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              {path.slice(folder.path.length + 1)}
                            </a>
                            <ValidationBadge
                              urlPath={path}
                              validationSummary={validationSummary}
                              onOpenDiagnosticsForUrl={onOpenDiagnosticsForUrl}
                            />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="flex-shrink-0 p-1 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`button-url-menu-${url.label.toLowerCase().replace(/\s+/g, '-')}`}
                                >
                                  <MoreVertical className="h-3 w-3 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => copyUrl(url.loc)} className="text-[13px]" data-testid={`menu-copy-url-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                  <Clipboard className="h-3.5 w-3.5 mr-2" />
                                  Copy URL
                                </DropdownMenuItem>
                                {isBlogUrl(url.loc) ? (
                                  <>
                                    <DropdownMenuItem onClick={() => { window.location.href = '/private/type/blog'; }} className="text-[13px]" data-testid={`menu-blog-manager-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                      <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                      Open Blog Manager
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRefreshCache(url)} className="text-[13px]" data-testid={`menu-refresh-cache-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                      <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                      Refresh Cache
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem onClick={() => handleDuplicatePage(url)} className="text-[13px]" data-testid={`menu-duplicate-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                      <Copy className="h-3.5 w-3.5 mr-2" />
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDownloadYml(url)} className="text-[13px]" data-testid={`menu-download-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                      <Download className="h-3.5 w-3.5 mr-2" />
                                      Download YAML
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleEditYaml(url)} className="text-[13px]" data-testid={`menu-edit-yaml-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                      <Code className="h-3.5 w-3.5 mr-2" />
                                      Edit YAML
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => { window.location.href = `/private/repository-sync?search=${encodeURIComponent(extractSlug(url.loc))}`; }}
                                      className="text-[13px]"
                                      data-testid={`menu-changelog-${url.label.toLowerCase().replace(/\s+/g, '-')}`}
                                    >
                                      <History className="h-3.5 w-3.5 mr-2" />
                                      View Change Log
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRefreshCache(url)} className="text-[13px]" data-testid={`menu-refresh-cache-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                      <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                      Refresh Cache
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDeletePage(url)} className="text-[13px] text-destructive" data-testid={`menu-delete-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {rootUrls.map((url, urlIndex) => {
                const path = new URL(url.loc).pathname;
                return (
                  <div
                    key={`root-${urlIndex}-${url.loc}`}
                    className="group flex items-center gap-1 px-3 py-1.5 rounded-md hover-elevate"
                  >
                    <a
                      href={path}
                      className="flex-1 min-w-0 text-xs text-muted-foreground cursor-pointer truncate"
                      data-testid={`link-sitemap-url-${url.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {path}
                    </a>
                    <ValidationBadge
                      urlPath={path}
                      validationSummary={validationSummary}
                      onOpenDiagnosticsForUrl={onOpenDiagnosticsForUrl}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="flex-shrink-0 p-1 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`button-url-menu-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          <MoreVertical className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => copyUrl(url.loc)} className="text-[13px]" data-testid={`menu-copy-url-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                          <Clipboard className="h-3.5 w-3.5 mr-2" />
                          Copy URL
                        </DropdownMenuItem>
                        {isBlogUrl(url.loc) ? (
                          <>
                            <DropdownMenuItem onClick={() => { window.location.href = '/private/type/blog'; }} className="text-[13px]" data-testid={`menu-blog-manager-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                              <ExternalLink className="h-3.5 w-3.5 mr-2" />
                              Open Blog Manager
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRefreshCache(url)} className="text-[13px]" data-testid={`menu-refresh-cache-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                              <RefreshCw className="h-3.5 w-3.5 mr-2" />
                              Refresh Cache
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem onClick={() => handleDuplicatePage(url)} className="text-[13px]" data-testid={`menu-duplicate-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                              <Copy className="h-3.5 w-3.5 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownloadYml(url)} className="text-[13px]" data-testid={`menu-download-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                              <Download className="h-3.5 w-3.5 mr-2" />
                              Download YAML
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleEditYaml(url)} className="text-[13px]" data-testid={`menu-edit-yaml-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                              <Code className="h-3.5 w-3.5 mr-2" />
                              Edit YAML
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => { window.location.href = `/private/repository-sync?search=${encodeURIComponent(extractSlug(url.loc))}`; }}
                              className="text-[13px]"
                              data-testid={`menu-changelog-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              <History className="h-3.5 w-3.5 mr-2" />
                              View Change Log
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRefreshCache(url)} className="text-[13px]" data-testid={`menu-refresh-cache-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                              <RefreshCw className="h-3.5 w-3.5 mr-2" />
                              Refresh Cache
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDeletePage(url)} className="text-[13px] text-destructive" data-testid={`menu-delete-root-${url.label.toLowerCase().replace(/\s+/g, '-')}`}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
