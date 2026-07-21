import { useState, useEffect } from "react";
import {
  IconArrowLeft,
  IconCheck,
  IconCode,
  IconLanguage,
  IconLoader2,
  IconPlus,
  IconStar,
  IconTrash,
  IconDeviceFloppy,
  IconPlayerPlay,
  IconAlertCircle,
  IconPhoto,
  IconChartBar,
  IconInfoCircle,
  IconScale,
  IconMessage,
  IconServer,
  IconRobot,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { ImagePickerDialog } from "@/components/editing/ImagePickerDialog";
import { LinkPicker } from "@/components/editing/LinkPicker";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ServerTab } from "@/components/settings/ServerTab";
import { RobotsTab } from "@/components/settings/RobotsTab";

const SETTINGS_TABS = ["locales", "migrations", "brand", "robots", "legal", "server"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function resolveSettingsTab(search: string): SettingsTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab && (SETTINGS_TABS as readonly string[]).includes(tab)) {
    return tab as SettingsTab;
  }
  return "locales";
}

interface LocaleEntry {
  code: string;
  label: string;
}

interface LocaleSettings {
  default_locale: string;
  supported_locales: LocaleEntry[];
}

interface Migration {
  filename: string;
  name: string;
  description: string;
}

interface MigrationRowState {
  running: boolean;
  result: { success: boolean; output: string } | null;
}


interface BrandSettings {
  default_social_image: string;
  twitter_handle: string;
  linkedin: string;
  facebook: string;
  youtube: string;
  instagram: string;
  github: string;
  unknown_same_as: string[];
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { hasCapability, isValidated } = useDebugAuth();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveSettingsTab(searchString));

  useEffect(() => {
    const tab = new URLSearchParams(searchString).get("tab");
    if (tab === "auth") {
      setLocation("/private/security/auth");
      return;
    }
    setActiveTab(resolveSettingsTab(searchString));
  }, [searchString, setLocation]);

  const { data, isLoading } = useQuery<LocaleSettings>({
    queryKey: ["/api/settings/locales"],
  });

  const { data: migrations, isLoading: migrationsLoading } = useQuery<Migration[]>({
    queryKey: ["/api/migrations"],
  });

  const { data: brandData, isLoading: brandLoading } = useQuery<BrandSettings>({
    queryKey: ["/api/admin/brand-settings"],
    enabled: isValidated === true,
  });

  const [locales, setLocales] = useState<LocaleEntry[]>([]);
  const [defaultLocale, setDefaultLocale] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [migrationStates, setMigrationStates] = useState<Record<string, MigrationRowState>>({});
  const [brandImagePickerOpen, setBrandImagePickerOpen] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);
  const [twitterHandle, setTwitterHandle] = useState("");
  const [twitterSaving, setTwitterSaving] = useState(false);
  const [socialLinks, setSocialLinks] = useState({ linkedin: "", facebook: "", youtube: "", instagram: "", github: "" });
  const [socialSaving, setSocialSaving] = useState<string | null>(null);
  const [socialErrors, setSocialErrors] = useState<Record<string, string | null>>({});

  const SOCIAL_DOMAINS: Record<string, string> = {
    linkedin: "linkedin.com",
    facebook: "facebook.com",
    youtube: "youtube.com",
    instagram: "instagram.com",
    github: "github.com",
  };

  function validateSocialUrl(key: string, value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return "Not a valid URL — make sure it starts with https://";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "URL must start with https://";
    }
    const expectedDomain = SOCIAL_DOMAINS[key];
    if (expectedDomain && !parsed.hostname.endsWith(expectedDomain)) {
      return `This doesn't look like a ${key.charAt(0).toUpperCase() + key.slice(1)} URL (expected ${expectedDomain})`;
    }
    return null;
  }

  const canEditSeo = hasCapability("seo_edit");

  interface LegalSettings {
    legal_terms_url: string;
    legal_privacy_url: string;
  }

  const { data: legalData, isLoading: legalLoading } = useQuery<LegalSettings>({
    queryKey: ["/api/settings/legal"],
  });

  const [legalTermsUrl, setLegalTermsUrl] = useState("");
  const [legalPrivacyUrl, setLegalPrivacyUrl] = useState("");
  const [legalSaving, setLegalSaving] = useState<string | null>(null);

  const CONSENT_CHANNELS = [
    { suffix: "consent_whatsapp", label: "WhatsApp" },
    { suffix: "consent_sms", label: "SMS" },
    { suffix: "consent_email", label: "Email" },
    { suffix: "consent_general", label: "General" },
  ] as const;

  type ConsentSuffix = typeof CONSENT_CHANNELS[number]["suffix"];

  const { data: consentData, refetch: refetchConsent } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings/consent"],
  });

  const [editingConsent, setEditingConsent] = useState<{ suffix: ConsentSuffix; label: string; value: string } | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);

  async function handleConsentSave() {
    if (!editingConsent) return;
    setConsentSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/consent", { [editingConsent.suffix]: editingConsent.value });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      await refetchConsent();
      setEditingConsent(null);
      toast({ title: "Saved", description: `${editingConsent.label} consent message updated.` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setConsentSaving(false);
    }
  }

  function validateLegalUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return "URL must start with https://";
      }
    } catch {
      // Allow relative paths like /en/terms-conditions
      if (!trimmed.startsWith("/")) {
        return "Enter a full URL (https://...) or a relative path starting with /";
      }
    }
    return null;
  }

  async function handleLegalSave(field: "legal_terms_url" | "legal_privacy_url", newValue?: string) {
    const value = newValue !== undefined ? newValue : (field === "legal_terms_url" ? legalTermsUrl : legalPrivacyUrl);
    setLegalSaving(field);
    try {
      const err = validateLegalUrl(value);
      if (err) {
        toast({ title: "Invalid URL", description: err, variant: "destructive" });
        return;
      }
      const res = await apiRequest("PUT", "/api/settings/legal", { [field]: value.trim() });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/legal"] });
      toast({ title: "Saved", description: "Legal URL updated." });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setLegalSaving(null);
    }
  }

  useEffect(() => {
    if (data) {
      setLocales(data.supported_locales.map((l) => ({ ...l })));
      setDefaultLocale(data.default_locale);
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    if (brandData) {
      setTwitterHandle(brandData.twitter_handle ?? "");
      setSocialLinks({
        linkedin: brandData.linkedin ?? "",
        facebook: brandData.facebook ?? "",
        youtube: brandData.youtube ?? "",
        instagram: brandData.instagram ?? "",
        github: brandData.github ?? "",
      });
    }
  }, [brandData]);

  useEffect(() => {
    if (legalData) {
      setLegalTermsUrl(legalData.legal_terms_url ?? "");
      setLegalPrivacyUrl(legalData.legal_privacy_url ?? "");
    }
  }, [legalData]);

  function addLocale() {
    const code = newCode.trim().toLowerCase();
    const label = newLabel.trim();
    if (!code || !label) return;
    if (!/^[a-z]{2,3}$/.test(code)) {
      toast({ title: "Invalid code", description: "Locale code must be 2-3 lowercase letters", variant: "destructive" });
      return;
    }
    if (locales.some((l) => l.code === code)) {
      toast({ title: "Duplicate", description: `Locale "${code}" already exists`, variant: "destructive" });
      return;
    }
    setLocales((prev) => [...prev, { code, label }]);
    setNewCode("");
    setNewLabel("");
    setDirty(true);
  }

  function removeLocale(code: string) {
    if (locales.length <= 1) return;
    if (code === defaultLocale) {
      toast({ title: "Cannot remove", description: "Set a different default locale first", variant: "destructive" });
      return;
    }
    setLocales((prev) => prev.filter((l) => l.code !== code));
    setDirty(true);
  }

  function setAsDefault(code: string) {
    setDefaultLocale(code);
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/locales", {
        default_locale: defaultLocale,
        supported_locales: locales,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/locales"] });
      setDirty(false);
      toast({ title: "Settings saved", description: `${locales.length} locale(s) configured` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleBrandSave(imageUrl: string) {
    setBrandSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        default_social_image: imageUrl,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      toast({ title: "Brand settings saved", description: "Default social image updated." });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setBrandSaving(false);
    }
  }

  async function handleTwitterSave() {
    setTwitterSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        twitter_handle: twitterHandle.trim(),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      toast({ title: "Twitter / X handle saved" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setTwitterSaving(false);
    }
  }

  async function handleSocialLinkSave(platform: keyof typeof socialLinks) {
    setSocialSaving(platform);
    try {
      const res = await apiRequest("PUT", "/api/admin/brand-settings", {
        [platform]: socialLinks[platform].trim(),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brand-settings"] });
      toast({ title: `${platform.charAt(0).toUpperCase() + platform.slice(1)} URL saved` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSocialSaving(null);
    }
  }

  async function runMigration(filename: string) {
    setMigrationStates((prev) => ({
      ...prev,
      [filename]: { running: true, result: null },
    }));
    try {
      const res = await apiRequest("POST", "/api/migrations/run", { filename });
      const result = await res.json();
      setMigrationStates((prev) => ({
        ...prev,
        [filename]: { running: false, result },
      }));
    } catch (err: any) {
      setMigrationStates((prev) => ({
        ...prev,
        [filename]: { running: false, result: { success: false, output: err.message || String(err) } },
      }));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-4">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Link href="/private/diagnostics">
              <Button variant="ghost" size="icon" data-testid="button-back-settings">
                <IconArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-settings-title">Settings</h1>
              <p className="text-sm text-muted-foreground">Site-wide configuration</p>
            </div>
          </div>
          <Link href="/private/tracking">
            <Button variant="outline" size="sm" data-testid="button-go-tracking">
              <IconChartBar className="h-4 w-4 mr-1.5" />
              Tracking
            </Button>
          </Link>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const next = v as SettingsTab;
            setActiveTab(next);
            const url = new URL(window.location.href);
            if (next === "locales") {
              url.searchParams.delete("tab");
            } else {
              url.searchParams.set("tab", next);
            }
            window.history.replaceState({}, "", url.pathname + url.search);
          }}
        >
          <TabsList className="flex w-full flex-wrap h-auto gap-1">
            <TabsTrigger value="locales" data-testid="tab-locales">
              <IconLanguage className="h-4 w-4 mr-1.5" />
              Locales
            </TabsTrigger>
            <TabsTrigger value="migrations" data-testid="tab-migrations">
              <IconCode className="h-4 w-4 mr-1.5" />
              Migrations
            </TabsTrigger>
            <TabsTrigger value="brand" data-testid="tab-brand">
              <IconPhoto className="h-4 w-4 mr-1.5" />
              Brand
            </TabsTrigger>
            <TabsTrigger value="robots" data-testid="tab-robots">
              <IconRobot className="h-4 w-4 mr-1.5" />
              Robots
            </TabsTrigger>
            <TabsTrigger value="legal" data-testid="tab-legal">
              <IconScale className="h-4 w-4 mr-1.5" />
              Legal
            </TabsTrigger>
            <TabsTrigger value="server" data-testid="tab-server">
              <IconServer className="h-4 w-4 mr-1.5" />
              Server
            </TabsTrigger>
          </TabsList>

          <TabsContent value="locales" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
                <div className="flex items-center gap-2">
                  <IconLanguage className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Internationalization</CardTitle>
                </div>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  data-testid="button-save-locales"
                >
                  {saving ? (
                    <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                  )}
                  Save
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Supported Locales</p>
                      <p className="text-xs text-muted-foreground">
                        Locales available for content and URL patterns. The default locale is used as fallback.
                      </p>
                    </div>

                    <div className="space-y-2">
                      {locales.map((locale) => (
                        <div
                          key={locale.code}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-md border"
                          data-testid={`row-locale-${locale.code}`}
                        >
                          <code className="text-sm font-mono font-medium w-8">{locale.code}</code>
                          <span className="text-sm flex-1">{locale.label}</span>
                          {locale.code === defaultLocale ? (
                            <Badge variant="secondary" className="gap-1" data-testid={`badge-default-${locale.code}`}>
                              <IconStar className="fill-current h-3 w-3" />
                              Default
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setAsDefault(locale.code)}
                              title="Set as default"
                              data-testid={`button-set-default-${locale.code}`}
                            >
                              <IconStar className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLocale(locale.code)}
                            disabled={locales.length <= 1 || locale.code === defaultLocale}
                            title="Remove locale"
                            data-testid={`button-remove-locale-${locale.code}`}
                          >
                            <IconTrash className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-end gap-2 pt-2 border-t">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Code</label>
                        <Input
                          placeholder="pt"
                          value={newCode}
                          onChange={(e) => setNewCode(e.target.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3))}
                          className="w-20"
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocale(); } }}
                          data-testid="input-new-locale-code"
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Label</label>
                        <Input
                          placeholder="Portuguese"
                          value={newLabel}
                          onChange={(e) => setNewLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocale(); } }}
                          data-testid="input-new-locale-label"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={addLocale}
                        disabled={!newCode.trim() || !newLabel.trim()}
                        data-testid="button-add-locale"
                      >
                        <IconPlus className="h-4 w-4 mr-1.5" />
                        Add
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="migrations" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconCode className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Migrations</CardTitle>
              </CardHeader>
              <CardContent>
                {migrationsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !migrations || migrations.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No migration scripts found.</p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      One-time data scripts. Each migration is idempotent — safe to re-run.
                    </p>
                    <div className="space-y-2">
                      {migrations.map((migration) => {
                        const state = migrationStates[migration.filename];
                        const running = state?.running ?? false;
                        const result = state?.result ?? null;
                        return (
                          <div key={migration.filename} className="space-y-2" data-testid={`row-migration-${migration.filename}`}>
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border">
                              <code className="text-xs font-mono text-muted-foreground flex-1 truncate" data-testid={`text-migration-name-${migration.filename}`}>
                                {migration.filename}
                              </code>
                              {result && (
                                result.success
                                  ? <IconCheck className="h-4 w-4 text-green-500 shrink-0" />
                                  : <IconAlertCircle className="h-4 w-4 text-destructive shrink-0" />
                              )}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="About this migration"
                                    data-testid={`button-info-migration-${migration.filename}`}
                                  >
                                    <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 text-sm" side="left" align="start">
                                  <p className="font-medium mb-1">{migration.name}</p>
                                  <p className="text-muted-foreground text-xs leading-relaxed">{migration.description}</p>
                                </PopoverContent>
                              </Popover>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => runMigration(migration.filename)}
                                disabled={running}
                                title="Run migration"
                                data-testid={`button-run-migration-${migration.filename}`}
                              >
                                {running
                                  ? <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  : <IconPlayerPlay className="h-4 w-4 text-muted-foreground" />
                                }
                              </Button>
                            </div>
                            {result && (
                              <pre
                                className={`text-xs font-mono rounded-md border px-3 py-2 overflow-auto max-h-48 whitespace-pre-wrap ${
                                  result.success
                                    ? "border-green-500/30 bg-green-500/5 text-foreground"
                                    : "border-destructive/30 bg-destructive/5 text-destructive"
                                }`}
                                data-testid={`text-migration-output-${migration.filename}`}
                              >
                                {result.output || (result.success ? "Done." : "Failed with no output.")}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brand" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconPhoto className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Brand Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {brandLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Default Social Image</p>
                      <p className="text-xs text-muted-foreground">
                        Used as the fallback <code className="font-mono">og:image</code> on pages that don't have a specific social image. Recommended size: 1200×630 px.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Saved to <code className="font-mono">4geeks-com/schema-org.yml</code> under <code className="font-mono">website.default_social_image</code>.
                      </p>
                    </div>

                    <div className="space-y-3">
                      {brandData?.default_social_image ? (
                        <div
                          className="rounded-md border bg-muted overflow-hidden"
                          style={{ aspectRatio: "1200/630", maxHeight: "160px" }}
                          data-testid="img-brand-social-preview-container"
                        >
                          <img
                            src={brandData.default_social_image}
                            alt="Default social image preview"
                            className="object-cover w-full h-full"
                            data-testid="img-brand-social-preview"
                          />
                        </div>
                      ) : (
                        <div
                          className="rounded-md border bg-muted flex items-center justify-center text-muted-foreground"
                          style={{ aspectRatio: "1200/630", maxHeight: "160px" }}
                          data-testid="div-brand-social-placeholder"
                        >
                          <div className="text-center space-y-1">
                            <IconPhoto className="h-8 w-8 mx-auto opacity-40" />
                            <p className="text-xs">No image selected</p>
                          </div>
                        </div>
                      )}

                      {brandData?.default_social_image && (
                        <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-brand-social-url">
                          {brandData.default_social_image}
                        </p>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBrandImagePickerOpen(true)}
                        disabled={brandSaving || !canEditSeo}
                        title={!canEditSeo ? "You don't have permission to edit brand settings" : undefined}
                        data-testid="button-brand-choose-image"
                      >
                        {brandSaving ? (
                          <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <IconPhoto className="h-4 w-4 mr-1.5" />
                        )}
                        Choose from gallery
                      </Button>
                    </div>

                    <div className="pt-2 border-t space-y-2">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Twitter / X Handle</p>
                        <p className="text-xs text-muted-foreground">
                          Saved to <code className="font-mono">4geeks-com/schema-org.yml</code> under <code className="font-mono">organization.same_as</code>.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={twitterHandle}
                          onChange={(e) => setTwitterHandle(e.target.value)}
                          placeholder="@handle"
                          disabled={twitterSaving || !canEditSeo}
                          data-testid="input-brand-twitter-handle"
                          className="font-mono"
                        />
                        <Button
                          size="sm"
                          onClick={handleTwitterSave}
                          disabled={twitterSaving || !canEditSeo}
                          title={!canEditSeo ? "You don't have permission to edit brand settings" : undefined}
                          data-testid="button-brand-save-twitter"
                        >
                          {twitterSaving ? (
                            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Social Links</p>
                        <p className="text-xs text-muted-foreground">
                          Stored in <code className="font-mono">organization.same_as</code> in <code className="font-mono">schema-org.yml</code>.
                        </p>
                      </div>
                      {(
                        [
                          { key: "linkedin", label: "LinkedIn", placeholder: "https://www.linkedin.com/school/yourorg/" },
                          { key: "facebook", label: "Facebook", placeholder: "https://www.facebook.com/yourorg" },
                          { key: "youtube", label: "YouTube", placeholder: "https://www.youtube.com/c/YourOrg" },
                          { key: "instagram", label: "Instagram", placeholder: "https://www.instagram.com/yourorg/" },
                          { key: "github", label: "GitHub", placeholder: "https://github.com/YourOrg" },
                        ] as { key: keyof typeof socialLinks; label: string; placeholder: string }[]
                      ).map(({ key, label, placeholder }) => {
                        const fieldError = socialErrors[key] ?? null;
                        return (
                          <div key={key} className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">{label}</label>
                            <div className="flex items-center gap-2">
                              <Input
                                value={socialLinks[key]}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSocialLinks((prev) => ({ ...prev, [key]: val }));
                                  setSocialErrors((prev) => ({ ...prev, [key]: validateSocialUrl(key, val) }));
                                }}
                                placeholder={placeholder}
                                disabled={socialSaving === key || !canEditSeo}
                                data-testid={`input-brand-${key}`}
                                className={`font-mono text-xs${fieldError ? " border-destructive focus-visible:ring-destructive" : ""}`}
                              />
                              <Button
                                size="sm"
                                onClick={() => handleSocialLinkSave(key)}
                                disabled={socialSaving === key || !canEditSeo || !!fieldError}
                                title={
                                  !canEditSeo
                                    ? "You don't have permission to edit brand settings"
                                    : fieldError
                                    ? fieldError
                                    : undefined
                                }
                                data-testid={`button-brand-save-${key}`}
                              >
                                {socialSaving === key ? (
                                  <IconLoader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <IconDeviceFloppy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            {fieldError && (
                              <p className="text-xs text-destructive" data-testid={`error-brand-${key}`}>
                                {fieldError}
                              </p>
                            )}
                          </div>
                        );
                      })}

                      {brandData?.unknown_same_as && brandData.unknown_same_as.length > 0 && (
                        <div className="pt-2 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Other links (read-only)</p>
                          <p className="text-xs text-muted-foreground">These URLs are in <code className="font-mono">same_as</code> but don't match a known platform. Edit them directly in the YAML file.</p>
                          <div className="space-y-1">
                            {brandData.unknown_same_as.map((url) => (
                              <p key={url} className="text-xs font-mono text-muted-foreground bg-muted rounded px-2 py-1 truncate" data-testid="text-brand-unknown-sameas">
                                {url}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <ImagePickerDialog
              open={brandImagePickerOpen}
              onOpenChange={setBrandImagePickerOpen}
              title="Select Default Social Image"
              initialSrc={brandData?.default_social_image ?? ""}
              initialAlt="Default social image"
              onSave={async (src) => {
                await handleBrandSave(src);
              }}
            />
          </TabsContent>

          <TabsContent value="robots" className="mt-4">
            <RobotsTab />
          </TabsContent>

          <TabsContent value="legal" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconScale className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Legal URLs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {legalLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">
                        These URLs are stored as <code className="font-mono">reserved.legal_terms_url</code> and <code className="font-mono">reserved.legal_privacy_url</code> in <code className="font-mono">variables.yml</code> and are automatically available as <code className="font-mono">global.*</code> variables site-wide.
                      </p>
                    </div>

                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="input-legal-terms-url">
                          Terms &amp; Conditions URL
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Used in lead forms and consent copy. Accepts a full URL or a relative path (e.g. <code className="font-mono">/en/terms-conditions</code>).
                        </p>
                        <div className="flex items-center gap-2">
                          <LinkPicker
                            value={legalTermsUrl}
                            onChange={(v) => { setLegalTermsUrl(v); handleLegalSave("legal_terms_url", v); }}
                            testId="link-picker-legal-terms-url"
                            allowedTypes={["internal", "external"]}
                          />
                          {legalSaving === "legal_terms_url" && (
                            <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="input-legal-privacy-url">
                          Privacy Policy URL
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Used in lead forms and consent copy. Accepts a full URL or a relative path (e.g. <code className="font-mono">/en/privacy-policy</code>).
                        </p>
                        <div className="flex items-center gap-2">
                          <LinkPicker
                            value={legalPrivacyUrl}
                            onChange={(v) => { setLegalPrivacyUrl(v); handleLegalSave("legal_privacy_url", v); }}
                            testId="link-picker-legal-privacy-url"
                            allowedTypes={["internal", "external"]}
                          />
                          {legalSaving === "legal_privacy_url" && (
                            <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader className="flex flex-row items-center gap-2 pb-4">
                <IconMessage className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <CardTitle className="text-base">Consent Messages</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  These are <code className="font-mono">reserved.*</code> variables — protected from the general variable editor and only editable here.
                </p>
                <div className="divide-y">
                  {CONSENT_CHANNELS.map((channel) => {
                    const preview = consentData?.[channel.suffix] ?? "";
                    return (
                      <div
                        key={channel.suffix}
                        className="flex items-center gap-3 py-3"
                        data-testid={`row-consent-${channel.suffix}`}
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{channel.label}</span>
                            <Badge variant="secondary" className="font-mono text-xs">
                              reserved.{channel.suffix}
                            </Badge>
                          </div>
                          {preview ? (
                            <p className="text-xs text-muted-foreground truncate max-w-md">
                              {preview}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground/60 italic">
                              No default set
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingConsent({ suffix: channel.suffix, label: channel.label, value: preview })}
                          data-testid={`button-edit-consent-${channel.suffix}`}
                        >
                          Edit
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Dialog open={editingConsent !== null} onOpenChange={(open) => { if (!open) setEditingConsent(null); }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingConsent?.label} Consent Message</DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <p className="text-xs text-muted-foreground mb-2">
                    Default message shown in forms. Leave blank to use the form's built-in default.
                  </p>
                  <Textarea
                    rows={4}
                    value={editingConsent?.value ?? ""}
                    onChange={(e) => setEditingConsent((prev) => prev ? { ...prev, value: e.target.value } : null)}
                    placeholder="Enter consent message…"
                    data-testid="input-consent-message"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditingConsent(null)}>Cancel</Button>
                  <Button onClick={handleConsentSave} disabled={consentSaving}>
                    {consentSaving ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="server" className="mt-4">
            <ServerTab />
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
