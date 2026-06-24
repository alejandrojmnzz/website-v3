import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, BarChart2, Blocks, Book, Brain, Check, ChevronRight, CloudDownload, Cookie, Database, Github, GitBranch, Image, Languages, Map, MapPin, Menu, MessageCircle, Monitor, Moon, Palette, Pencil, Plus, RefreshCw, Route, Settings, Smartphone, Stethoscope, Sun, X } from "lucide-react";
import { IconLogout, IconServer, IconShoppingBag, IconTargetArrow, IconShield, IconAlertTriangle, IconLayersIntersect } from "@tabler/icons-react";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useTranslation } from "react-i18next";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeLocale } from "@/lib/locale";
import { SyncStatusPopover } from "./SyncStatusPopover";
import { ComponentsView } from "./ComponentsView";
import { VersioningView } from "./VersioningView";
import { MenusView } from "./MenusView";
import { CreateMenuModal } from "./CreateMenuModal";
import { DatabasesView } from "./DatabasesView";
import { ContentTypesView } from "./ContentTypesView";
import { SitemapView } from "./SitemapView";
import type {
  MenuView,
  ContentInfo,
  GitHubSyncStatus,
  SitemapUrl,
  ComponentItem,
  MenuItemProps,
  ExpandableMenuItemProps,
} from "../types";

interface EditModeState {
  isEditMode: boolean;
  toggleEditMode: () => void;
  previewBreakpoint: string;
  setPreviewBreakpoint: (bp: string) => void;
}

interface BreathecodeHost {
  host: string;
  isDefault: boolean;
}

export interface DebugPanelContentProps {
  noTokenDetected: boolean;
  tokenWithoutCapabilities: boolean;
  hasToken: boolean;
  tokenInput: string;
  setTokenInput: (v: string) => void;
  setPendingAutoEditMode: (v: boolean) => void;
  validateManualToken: (token: string) => void;
  isLoading: boolean;
  breathecodeHost: BreathecodeHost | null;
  retryValidation: () => void;
  clearToken: () => void;

  githubSyncStatus: GitHubSyncStatus | null;
  syncStatusLoading: boolean;
  refreshSyncStatus: () => void;
  fetchPendingChanges: () => void;
  setCommitModalOpen: (v: boolean) => void;

  contentInfo: ContentInfo;
  editMode: EditModeState | null;
  pathname: string;
  navigate: (path: string) => void;
  setSeoModalOpen: (v: boolean) => void;
  fetchSeoPreview: () => void;

  menuView: MenuView;
  setMenuView: (v: MenuView) => void;

  sitemapExpanded: boolean;
  setSitemapExpanded: (v: boolean) => void;
  componentsExpanded: boolean;
  setComponentsExpanded: (v: boolean) => void;
  aiAgentsExpanded: boolean;
  setAiAgentsExpanded: (v: boolean) => void;
  cacheClearStatus: string;
  clearSitemapCache: () => void;
  sitemapUrlCount: number | null;
  redirectsList: Array<{ from: string; to: string }>;

  componentSearch: string;
  setComponentSearch: (v: string) => void;
  showComponentSearch: boolean;
  setShowComponentSearch: (v: boolean) => void;
  filteredComponents: ComponentItem[];
  componentRegistryData: unknown;
  componentIconMap: Record<string, unknown>;

  versioningLoading: boolean;
  versioningData: unknown;
  onVersioningDataUpdate?: (data: unknown) => void;
  onEditVariantYaml: (locale: string, variantSlug: string) => void;
  handleLinkClick: (href: string) => void;

  sitemapUrls: SitemapUrl[];
  sitemapLoading: boolean;
  sitemapSearch: string;
  setSitemapSearch: (v: string) => void;
  showSitemapSearch: boolean;
  setShowSitemapSearch: (v: boolean) => void;
  filteredSitemapUrls: SitemapUrl[];
  folders: Record<string, SitemapUrl[]>;
  rootUrls: SitemapUrl[];
  expandedFolders: Set<string>;
  toggleFolder: (folder: string) => void;
  setCreateContentModalOpen: (v: boolean) => void;
  handleDuplicatePage: (url: string) => void;
  handleDeletePage: (url: string) => void;
  handleDownloadYml: (url: string) => void;
  handleEditYaml: (url: string) => void;
  handleRefreshCache: (url: SitemapUrl) => void;
  validationSummary: Record<string, { errorCount: number; warningCount: number }>;
  onOpenDiagnosticsForUrl: (urlPath: string) => void;
  contentLocale: string | null;

  session: { location?: { slug?: string; name?: string } };
  currentLocationOverride: string | null;
  setSelectedLocationSlug: (v: string) => void;
  setLocationModalOpen: (v: boolean) => void;
  currentLang: string;
  toggleLanguage: () => void;
  theme: "light" | "dark";
  toggleTheme: () => void;

  isCheckingSession: boolean;
  handleCheckSession: () => void;
  setSessionModalOpen: (v: boolean) => void;
  publicPageUrl: string | null;
}

function MenuItem({ icon: Icon, label, onClick, href, testId, rightContent, indicator = "none", disabled, className }: MenuItemProps) {
  const hasRightSide = rightContent || indicator !== "none";
  const baseClass = disabled
    ? "flex items-center justify-between w-full px-3 py-2 rounded-md text-sm text-muted-foreground cursor-default"
    : "flex items-center justify-between w-full px-3 py-2 rounded-md text-sm hover-elevate";
  const combinedClass = className ? `${baseClass} ${className}` : baseClass;

  const content = (
    <>
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span>{label}</span>
      </div>
      {hasRightSide && (
        <div className="flex items-center gap-1.5">
          {rightContent}
          {indicator === "chevron" && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {indicator === "arrow" && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      )}
    </>
  );

  if (disabled) {
    return <div className={combinedClass} data-testid={testId}>{content}</div>;
  }
  if (href) {
    return <a href={href} className={combinedClass} data-testid={testId}>{content}</a>;
  }
  if (onClick) {
    return <button onClick={onClick} className={combinedClass} data-testid={testId}>{content}</button>;
  }
  return <div className={combinedClass} data-testid={testId}>{content}</div>;
}

function ExpandableMenuItem({ icon: Icon, label, expanded, onToggle, testId, actions, children }: ExpandableMenuItemProps) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between w-full px-3 py-2 rounded-md text-sm">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 flex-1 hover-elevate rounded-md -ml-1 pl-1 py-0.5"
          data-testid={testId}
        >
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{label}</span>
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        {actions}
      </div>
      {expanded && (
        <div className="ml-2 pl-1 space-y-0.5 rounded-md py-1" style={{ backgroundColor: "hsl(var(--muted-foreground) / 0.1)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function DebugPanelContent(props: DebugPanelContentProps) {
  const { i18n } = useTranslation();
  const { hasCapability } = useDebugAuth();
  const canManageUsers = hasCapability("users_manage");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [storeExpanded, setStoreExpanded] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  const { data: versionData } = useQuery<{ version: string }>({
    queryKey: ["/api/version"],
    staleTime: Infinity,
  });

  const { data: errorLogData } = useQuery<{ totalErrors: number; totalWarnings: number }>({
    queryKey: ["/api/admin/error-log", "badge"],
    queryFn: async () => {
      const res = await fetch("/api/admin/error-log");
      if (!res.ok) throw new Error("Failed to fetch error log");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const errorLogCount = (errorLogData?.totalErrors ?? 0) + (errorLogData?.totalWarnings ?? 0);

  if (props.noTokenDetected) {
    return (
      <div className="p-4 pl-[8px] pr-[8px]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900 flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-1">No token detected</h3>
            <p className="text-xs text-muted-foreground mb-1">
              Enter your token below or add <code className="bg-muted px-1 rounded">?token=xxx</code> to URL, or{" "}
              <a
                href={`https://breathecode.herokuapp.com/v1/auth/view/login?url=${encodeURIComponent(window.location.href)}`}
                className="text-primary underline hover:no-underline"
                data-testid="link-login"
              >
                click here to login
              </a>
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Only users with <code className="bg-muted px-1 rounded">webmaster</code> capability will be able to edit the website.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter token..."
                value={props.tokenInput}
                onChange={(e) => props.setTokenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && props.tokenInput.trim()) {
                    props.setPendingAutoEditMode(true);
                    props.validateManualToken(props.tokenInput.trim());
                  }
                }}
                className="flex-1 px-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="input-token"
              />
              <Button
                size="sm"
                onClick={() => {
                  props.setPendingAutoEditMode(true);
                  props.validateManualToken(props.tokenInput.trim());
                }}
                disabled={!props.tokenInput.trim() || props.isLoading}
                data-testid="button-validate-token"
              >
                {props.isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  "Validate"
                )}
              </Button>
            </div>
            {props.breathecodeHost && !props.breathecodeHost.isDefault && (
              <div className="flex items-start gap-1.5 mt-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div>The host is pointing to</div>
                  <div className="font-mono break-all">{props.breathecodeHost.host}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (props.tokenWithoutCapabilities) {
    return (
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-1">Limited access</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Token detected but no webmaster capabilities have been detected
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={props.retryValidation}
                disabled={props.isLoading}
                className="flex-1"
                data-testid="button-retry-validation"
              >
                {props.isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Retry
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={props.clearToken}
                disabled={props.isLoading}
                data-testid="button-clear-token"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {props.githubSyncStatus?.syncEnabled && props.githubSyncStatus.status === 'invalid-credentials' && (
        <div className="p-3 bg-red-100 dark:bg-red-900/50 border-b border-red-200 dark:border-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-red-800 dark:text-red-200">
                Invalid GitHub Credentials for Sync
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                Check GITHUB_TOKEN and GITHUB_REPO_URL settings
              </p>
            </div>
          </div>
        </div>
      )}

      {props.githubSyncStatus && !props.githubSyncStatus.syncEnabled && props.githubSyncStatus.configured && (
        <div className="p-3 bg-muted/50 border-b border-border">
          <div className="flex items-start gap-2">
            <Github className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-foreground">
                GitHub Sync is Disabled
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set GITHUB_SYNC_ENABLED=true to enable
              </p>
            </div>
          </div>
        </div>
      )}

      {props.githubSyncStatus && (props.githubSyncStatus.status === 'behind' || props.githubSyncStatus.status === 'diverged') && (
        <div className="p-3 bg-amber-100 dark:bg-amber-900/50 border-b border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                {props.githubSyncStatus.status === 'behind'
                  ? 'Pull latest changes before publishing'
                  : 'Local and remote have diverged'}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Production content edits may be overwritten
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="p-3 border-b pl-[8px] pr-[8px] pt-[3px] pb-[3px]">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Dev Tools</h3>
          <div className="flex items-center gap-2">
            {props.contentInfo.type && props.contentInfo.slug && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  props.setSeoModalOpen(true);
                  props.fetchSeoPreview();
                }}
                className="px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground transition-colors hover-elevate"
                data-testid="button-edit-seo"
                title="Edit page SEO & meta tags"
              >
                META
              </button>
            )}
            {props.editMode && (
              <div
                className="flex items-center bg-muted rounded-full p-0.5"
                data-testid="toggle-edit-mode"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!props.editMode!.isEditMode) {
                      props.editMode!.toggleEditMode();
                      if (props.contentInfo.type && props.contentInfo.slug && !props.pathname.startsWith('/private/preview/')) {
                        const pathSegments = props.pathname.split('/').filter(Boolean);
                        const urlLocale = pathSegments[0];
                        const hasPathLocale = /^[a-z]{2}$/.test(urlLocale);
                        const resolvedLocale = hasPathLocale ? normalizeLocale(urlLocale) : (props.contentLocale || normalizeLocale(i18n.language));
                        const previewUrl = `/private/preview/${props.contentInfo.type}/${props.contentInfo.slug}?locale=${resolvedLocale}`;
                        props.navigate(previewUrl);
                      }
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    props.editMode.isEditMode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                  data-testid="button-edit-mode"
                >
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (props.editMode!.isEditMode) {
                      props.editMode!.toggleEditMode();
                      if (props.publicPageUrl) {
                        props.navigate(props.publicPageUrl);
                      }
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    !props.editMode.isEditMode
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  data-testid="button-read-mode"
                >
                  Read
                </button>
              </div>
            )}
            {props.editMode && props.editMode.isEditMode && (
              <div
                className="flex items-center bg-muted rounded-full p-0.5"
                data-testid="toggle-preview-breakpoint"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    props.editMode!.setPreviewBreakpoint('desktop');
                  }}
                  className={`p-1.5 rounded-full transition-colors ${
                    props.editMode.previewBreakpoint === 'desktop'
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  data-testid="button-preview-desktop"
                  title="Preview desktop view"
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    props.editMode!.setPreviewBreakpoint('mobile');
                  }}
                  className={`p-1.5 rounded-full transition-colors ${
                    props.editMode.previewBreakpoint === 'mobile'
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  data-testid="button-preview-mobile"
                  title="Preview mobile view"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {props.menuView === "main" ? (
        <>
          <div className="p-2 space-y-1">
            <ExpandableMenuItem
              icon={Map}
              label="Content & Sitemap"
              expanded={props.sitemapExpanded}
              onToggle={() => {
                const opening = !props.sitemapExpanded;
                props.setSitemapExpanded(opening);
                if (opening) {
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-sitemap-toggle"
              actions={
                <button
                  onClick={props.clearSitemapCache}
                  disabled={props.cacheClearStatus === "loading"}
                  className="p-1 rounded hover-elevate disabled:opacity-50"
                  data-testid="button-clear-sitemap-cache"
                  title="Clear sitemap cache"
                >
                  {props.cacheClearStatus === "loading" ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : props.cacheClearStatus === "success" ? (
                    <Check className="h-3.5 w-3.5 text-chart-3" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </button>
              }
            >

              <MenuItem
                icon={Map}
                label="Indexed URLs"
                onClick={() => props.setMenuView("sitemap")}
                indicator="chevron"
                testId="button-sitemap-all-urls"
                rightContent={<span className="text-xs text-muted-foreground">{props.sitemapUrlCount !== null ? props.sitemapUrlCount : '...'}</span>}
              />
              <MenuItem
                icon={Route}
                label="Redirects"
                href="/private/redirects"
                indicator="arrow"
                testId="link-redirects-page"
                rightContent={<span className="text-xs text-muted-foreground">{props.redirectsList.length || '...'}</span>}
              />
              <MenuItem
                icon={Book}
                label="Content Types"
                onClick={() => props.setMenuView("content-types")}
                indicator="chevron"
                testId="button-content-types-menu"
              />
              <MenuItem
                icon={Image}
                label="Media Gallery"
                href="/private/media-gallery"
                indicator="arrow"
                testId="link-media-gallery"
              />
              <MenuItem
                icon={Database}
                label="Content Databases"
                onClick={() => props.setMenuView("databases")}
                indicator="chevron"
                testId="button-databases-menu"
              />
              {props.contentInfo.type && props.contentInfo.slug && (
                <MenuItem
                  icon={GitBranch}
                  label="Versions"
                  onClick={() => props.setMenuView("versioning")}
                  indicator="chevron"
                  testId="button-versioning-menu"
                  rightContent={<span className="text-xs text-muted-foreground">{props.contentInfo.label}</span>}
                />
              )}
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={Blocks}
              label="Components"
              expanded={props.componentsExpanded}
              onToggle={() => {
                const opening = !props.componentsExpanded;
                props.setComponentsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-components-toggle"
            >
              <MenuItem
                icon={Blocks}
                label="Component Gallery"
                onClick={() => props.setMenuView("components")}
                indicator="chevron"
                testId="button-gallery-registry"
              />
              <MenuItem
                icon={Menu}
                label="Menus"
                onClick={() => props.setMenuView("menus")}
                indicator="chevron"
                testId="button-menus-menu"
              />
              <MenuItem
                icon={BarChart2}
                label="Component Insights"
                href="/private/component-insights"
                indicator="arrow"
                testId="link-component-insights"
              />
              <MenuItem
                icon={IconLayersIntersect}
                label="Modals & CTA"
                href="/private/overlays"
                indicator="arrow"
                testId="link-overlays"
              />
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={Brain}
              label="AI & Agents"
              expanded={props.aiAgentsExpanded}
              onToggle={() => {
                const opening = !props.aiAgentsExpanded;
                props.setAiAgentsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-ai-agents-toggle"
            >
              <MenuItem
                icon={IconServer}
                label="MCP Server"
                href="/private/mcp-server"
                indicator="arrow"
                testId="link-mcp-server"
              />
              <MenuItem
                icon={Pencil}
                label="Knowledge Editor"
                href="/private/ai-knowledge"
                indicator="arrow"
                testId="link-ai-knowledge"
              />
              <MenuItem
                icon={MessageCircle}
                label="Conversation Review"
                href="/private/ai-conversations"
                indicator="arrow"
                testId="link-ai-conversations"
              />
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={Stethoscope}
              label="Errors & Diagnostics"
              expanded={diagnosticsExpanded}
              onToggle={() => {
                const opening = !diagnosticsExpanded;
                setDiagnosticsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                }
              }}
              testId="button-diagnostics-toggle"
            >
              <MenuItem
                icon={Stethoscope}
                label="Diagnostics"
                href="/private/diagnostics"
                indicator="arrow"
                testId="link-diagnostics"
              />
              <MenuItem
                icon={IconAlertTriangle}
                label="Server Error Log"
                href="/private/error-log"
                indicator="arrow"
                testId="link-error-log"
                rightContent={
                  errorLogCount > 0 ? (
                    <span
                      className={cn(
                        badgeVariants({ variant: errorLogData && errorLogData.totalErrors > 0 ? "destructive" : "secondary" }),
                        "text-xs px-1.5 py-0 min-w-[1.25rem] text-center tabular-nums"
                      )}
                      data-testid="badge-error-log-count"
                    >
                      {errorLogCount}
                    </span>
                  ) : undefined
                }
              />
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={IconShoppingBag}
              label="Store & Monetization"
              expanded={storeExpanded}
              onToggle={() => {
                const opening = !storeExpanded;
                setStoreExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-store-toggle"
            >
              <MenuItem
                icon={IconShoppingBag}
                label="Products"
                href="/private/store/products"
                indicator="arrow"
                testId="link-store-products"
              />
              <MenuItem
                icon={IconShoppingBag}
                label="Plans"
                href="/private/store/plans"
                indicator="arrow"
                testId="link-store-plans"
              />
              <MenuItem
                icon={IconTargetArrow}
                label="Conversions"
                href="/private/store/conversions"
                indicator="arrow"
                testId="link-store-conversions"
              />
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={Settings}
              label="Settings"
              expanded={settingsExpanded}
              onToggle={() => {
                const opening = !settingsExpanded;
                setSettingsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-settings-toggle"
            >
              <MenuItem
                icon={Settings}
                label="General"
                href="/private/settings"
                indicator="arrow"
                testId="link-settings-general"
              />
              <MenuItem
                icon={Palette}
                label="Theme Editor"
                href="/private/theme-editor"
                indicator="arrow"
                testId="link-theme-editor"
              />
              <MenuItem
                icon={BarChart2}
                label="Tracking"
                href="/private/tracking"
                indicator="arrow"
                testId="link-tracking"
              />
              {canManageUsers && (
                <MenuItem
                  icon={IconShield}
                  label="Security"
                  href="/private/security"
                  indicator="arrow"
                  testId="link-security"
                />
              )}
            </ExpandableMenuItem>

            <div className="flex items-center justify-between w-full px-3 py-2 rounded-md text-sm">
              <div className="flex items-center gap-3">
                <Github className="h-4 w-4 text-muted-foreground" />
                <span>GitHub Sync</span>
                {props.githubSyncStatus && !props.githubSyncStatus.syncEnabled && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    Disabled
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SyncStatusPopover>
                  {props.syncStatusLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : props.githubSyncStatus ? (
                    <>
                      {props.githubSyncStatus.status === 'in-sync' && (
                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                          <Check className="h-3.5 w-3.5" />
                          In sync
                        </span>
                      )}
                      {props.githubSyncStatus.status === 'behind' && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <CloudDownload className="h-3.5 w-3.5" />
                          {props.githubSyncStatus.behindBy} behind
                        </span>
                      )}
                      {props.githubSyncStatus.status === 'ahead' && (
                        <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                          {props.githubSyncStatus.aheadBy} ahead
                        </span>
                      )}
                      {props.githubSyncStatus.status === 'diverged' && (
                        <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Diverged
                        </span>
                      )}
                      {props.githubSyncStatus.status === 'invalid-credentials' && (
                        <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Invalid Credentials
                        </span>
                      )}
                      {props.githubSyncStatus.status === 'not-configured' && (
                        <span className="text-xs text-muted-foreground">Not configured</span>
                      )}
                      {props.githubSyncStatus.status === 'unknown' && (
                        <span className="text-xs text-amber-600 dark:text-amber-400" title="Could not compare local and remote commits">
                          Check failed
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">--</span>
                  )}
                </SyncStatusPopover>
                <button
                  onClick={props.refreshSyncStatus}
                  disabled={props.syncStatusLoading}
                  className="p-1 rounded hover-elevate disabled:opacity-50"
                  data-testid="button-refresh-sync-status"
                  title="Refresh sync status"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${props.syncStatusLoading ? 'animate-spin' : ''}`} />
                </button>
                {props.githubSyncStatus?.syncEnabled && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      props.fetchPendingChanges();
                      props.setCommitModalOpen(true);
                    }}
                    className="p-1 rounded hover-elevate"
                    data-testid="button-open-sync-modal"
                    title="Manage file sync"
                  >
                    <CloudDownload className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="border-t p-2 space-y-1">
              <div className="flex items-center justify-between px-3 py-1.5">
                <div className="flex flex-col">
                  <div
                    className="flex items-center gap-2 cursor-pointer hover-elevate rounded px-1 -mx-1"
                    onClick={() => props.setSessionModalOpen(true)}
                    data-testid="button-session-header"
                    title="View session data"
                  >
                    <Cookie className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Session</span>
                    {!props.hasToken && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">(no auth)</span>
                    )}
                  </div>
                  {versionData?.version && (
                    <span className="text-[10px] text-muted-foreground px-1 -mx-1" data-testid="text-app-version">v{versionData.version}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer text-xs gap-1 no-default-active-elevate")}
                    onClick={() => {
                      props.setSelectedLocationSlug(props.session.location?.slug || "");
                      props.setLocationModalOpen(true);
                    }}
                    data-testid="button-location-override"
                    title={props.currentLocationOverride ? `Location override: ${props.currentLocationOverride}` : 'Click to override location'}
                  >
                    <MapPin className="h-3 w-3" />
                    <span className="max-w-[80px] truncate">{props.session.location?.name || 'Detecting...'}</span>
                  </button>
                  <button
                    className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer text-xs gap-1 no-default-active-elevate")}
                    onClick={props.toggleLanguage}
                    data-testid="button-toggle-language"
                    title="Click to toggle language"
                  >
                    <Languages className="h-3 w-3" />
                    <span>{props.currentLang.toUpperCase()}</span>
                  </button>
                  <button
                    className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer text-xs gap-1 no-default-active-elevate")}
                    onClick={props.toggleTheme}
                    data-testid="button-toggle-theme"
                    title="Click to toggle theme"
                  >
                    {props.theme === "light"
                      ? <Sun className="h-3 w-3" />
                      : <Moon className="h-3 w-3" />}
                    <span className="capitalize">{props.theme}</span>
                  </button>
                  {props.hasToken && (
                    <button
                      onClick={props.clearToken}
                      className="p-1 rounded hover-elevate"
                      data-testid="button-logout"
                      title="Logout"
                    >
                      <IconLogout className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
          </div>
        </>
      ) : props.menuView === "components" ? (
        <ComponentsView
          componentSearch={props.componentSearch}
          setComponentSearch={props.setComponentSearch}
          showComponentSearch={props.showComponentSearch}
          setShowComponentSearch={props.setShowComponentSearch}
          setMenuView={props.setMenuView}
          filteredComponents={props.filteredComponents}
          componentRegistryData={props.componentRegistryData}
          componentIconMap={props.componentIconMap}
        />
      ) : props.menuView === "versioning" ? (
        <VersioningView
          setMenuView={props.setMenuView}
          contentInfo={props.contentInfo}
          versioningLoading={props.versioningLoading}
          versioningData={props.versioningData as any}
          navigate={props.navigate}
          pathname={props.pathname}
          onVersioningDataUpdate={props.onVersioningDataUpdate as any}
          onEditVariantYaml={props.onEditVariantYaml}
        />
      ) : props.menuView === "menus" ? (
        <>
          <div className="px-3 py-2 border-b">
            <div className="flex items-center gap-3 justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => props.setMenuView("main")}
                  className="p-1 rounded-md hover-elevate"
                  data-testid="button-back-to-main-menus"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div>
                  <h3 className="font-semibold text-sm">Menus</h3>
                  <p className="text-xs text-muted-foreground">Navigation menu configurations</p>
                </div>
              </div>
              <button
                onClick={() => setCreateMenuOpen(true)}
                className="p-1 rounded-md hover-elevate"
                title="Create new menu"
                data-testid="button-create-menu"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          <ScrollArea className="h-[280px]">
            <div className="p-2 space-y-1">
              <MenusView />
            </div>
          </ScrollArea>

          <CreateMenuModal open={createMenuOpen} onOpenChange={setCreateMenuOpen} />
        </>
      ) : props.menuView === "databases" ? (
        <DatabasesView setMenuView={props.setMenuView} />
      ) : props.menuView === "content-types" ? (
        <ContentTypesView setMenuView={props.setMenuView} />
      ) : (
        <SitemapView
          setMenuView={props.setMenuView}
          sitemapUrls={props.sitemapUrls}
          sitemapLoading={props.sitemapLoading}
          sitemapSearch={props.sitemapSearch}
          setSitemapSearch={props.setSitemapSearch}
          showSitemapSearch={props.showSitemapSearch}
          setShowSitemapSearch={props.setShowSitemapSearch}
          filteredSitemapUrls={props.filteredSitemapUrls}
          folders={props.folders}
          rootUrls={props.rootUrls}
          expandedFolders={props.expandedFolders}
          toggleFolder={props.toggleFolder}
          setCreateContentModalOpen={props.setCreateContentModalOpen}
          handleDuplicatePage={props.handleDuplicatePage}
          handleDeletePage={props.handleDeletePage}
          handleDownloadYml={props.handleDownloadYml}
          handleEditYaml={props.handleEditYaml}
          handleRefreshCache={props.handleRefreshCache}
          validationSummary={props.validationSummary}
          onOpenDiagnosticsForUrl={props.onOpenDiagnosticsForUrl}
        />
      )}
    </>
  );
}
