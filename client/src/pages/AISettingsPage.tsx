import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconCheck,
  IconDeviceFloppy,
  IconLoader2,
  IconAlertCircle,
  IconCircleCheck,
  IconSparkles,
  IconFileCode,
} from "@tabler/icons-react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";

const LlmYmlEditorPanel = lazy(() => import("@/components/editing/LlmYmlEditorPanel"));

interface AISettingsResponse {
  model_default: string;
  provider: {
    api_key_env: string;
    base_url_env: string;
    base_url: string | null;
    api_key_configured: boolean;
  };
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
}

interface OpenRouterModelsResponse {
  models: OpenRouterModel[];
  error?: string;
}

function aiRequestHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...getSessionHeaders() };
}

export default function AISettingsPage() {
  const { toast } = useToast();
  const [selectedModel, setSelectedModel] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showYmlEditor, setShowYmlEditor] = useState(false);

  const settingsQuery = useQuery<AISettingsResponse>({
    queryKey: ["/api/admin/ai/settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai/settings", { headers: getSessionHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load settings (${res.status})`);
      }
      return res.json();
    },
  });

  const modelsQuery = useQuery<OpenRouterModelsResponse>({
    queryKey: ["/api/admin/ai/openrouter/models"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ai/openrouter/models", { headers: getSessionHeaders() });
      const body = (await res.json().catch(() => ({ models: [] }))) as OpenRouterModelsResponse;
      if (!res.ok) {
        throw new Error(body.error || `Failed to load models (${res.status})`);
      }
      return body;
    },
    enabled: Boolean(settingsQuery.data?.provider.api_key_configured),
    retry: false,
  });

  useEffect(() => {
    if (settingsQuery.data?.model_default) {
      setSelectedModel(settingsQuery.data.model_default);
    }
  }, [settingsQuery.data?.model_default]);

  const models = modelsQuery.data?.models ?? [];
  const dirty = selectedModel !== (settingsQuery.data?.model_default || "");
  const selectedLabel = useMemo(() => {
    const match = models.find((m) => m.id === selectedModel);
    return match ? `${match.name} (${match.id})` : selectedModel || "Select a model…";
  }, [models, selectedModel]);

  async function handleSave() {
    if (!selectedModel.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai/settings", {
        method: "PATCH",
        headers: aiRequestHeaders(),
        body: JSON.stringify({ model_default: selectedModel.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/ai/settings"] });
      toast({
        title: "AI settings saved",
        description: "Completion model updated for field mapping and autocompletions.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save AI settings.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild data-testid="button-ai-settings-back">
            <Link href="/private/diagnostics">
              <IconArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <IconSparkles className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-ai-settings-title">
                AI Settings
              </h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShowYmlEditor(true)}
                    data-testid="button-edit-llm-yml"
                  >
                    <IconFileCode className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Edit llm.yml
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-sm text-muted-foreground">
              Configure the OpenRouter model used for AI autocompletions and field mapping.
            </p>
          </div>
        </div>

        {settingsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <IconLoader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading settings…</span>
          </div>
        ) : settingsQuery.isError ? (
          <Card>
            <CardContent className="pt-6 flex items-start gap-3 text-destructive">
              <IconAlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <p className="text-sm">
                {settingsQuery.error instanceof Error
                  ? settingsQuery.error.message
                  : "Failed to load AI settings."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Provider</CardTitle>
                <CardDescription>
                  API keys are read from environment variables (same pattern as the previous Groq setup).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {settingsQuery.data?.provider.api_key_configured ? (
                    <Badge
                      variant="secondary"
                      className="gap-1 border-transparent bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                      data-testid="badge-api-key-ok"
                    >
                      <IconCircleCheck className="h-3.5 w-3.5" />
                      {settingsQuery.data.provider.api_key_env} configured
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1" data-testid="badge-api-key-missing">
                      <IconAlertCircle className="h-3.5 w-3.5" />
                      Set {settingsQuery.data?.provider.api_key_env} in environment
                    </Badge>
                  )}
                </div>
                <dl className="grid gap-2 text-sm">
                  <div className="flex flex-col sm:flex-row sm:gap-3">
                    <dt className="text-muted-foreground sm:w-32 shrink-0">API key env</dt>
                    <dd className="font-mono text-xs sm:text-sm">{settingsQuery.data?.provider.api_key_env}</dd>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:gap-3">
                    <dt className="text-muted-foreground sm:w-32 shrink-0">Base URL</dt>
                    <dd className="font-mono text-xs sm:text-sm break-all">
                      {settingsQuery.data?.provider.base_url || "—"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Completion model</CardTitle>
                <CardDescription>
                  Used for field mapping auto-detect, content adaptation, table builders, and other non-chat completions.
                  Chat model is configured in the Knowledge Editor.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
                  Saving writes the selected model id to <code className="font-mono text-[11px]">llm.yml</code> as{" "}
                  <code className="font-mono text-[11px]">model.default</code>. Other fields (
                  <code className="font-mono text-[11px]">model.chat</code>,{" "}
                  <code className="font-mono text-[11px]">model.vision</code>, prompts, tools) are left unchanged.
                </p>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="completion-model">
                    OpenRouter model
                  </label>
                  <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="completion-model"
                        variant="outline"
                        role="combobox"
                        aria-expanded={modelPickerOpen}
                        disabled={!settingsQuery.data?.provider.api_key_configured || modelsQuery.isLoading}
                        className="w-full justify-between font-normal"
                        data-testid="button-model-picker"
                      >
                        <span className="truncate text-left">
                          {modelsQuery.isLoading ? "Loading models…" : selectedLabel}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search models…" data-testid="input-search-models" />
                        <CommandList>
                          <CommandEmpty>No models found.</CommandEmpty>
                          <CommandGroup>
                            {models.map((model) => (
                              <CommandItem
                                key={model.id}
                                value={`${model.id} ${model.name}`}
                                onSelect={() => {
                                  setSelectedModel(model.id);
                                  setModelPickerOpen(false);
                                }}
                                data-testid={`model-option-${model.id}`}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedModel === model.id ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="text-sm truncate">{model.name}</span>
                                  <span className="text-xs text-muted-foreground font-mono truncate">
                                    {model.id}
                                    {model.context_length
                                      ? ` · ${model.context_length.toLocaleString()} ctx`
                                      : ""}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {modelsQuery.isError && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <IconAlertCircle className="h-3.5 w-3.5" />
                      {modelsQuery.error instanceof Error
                        ? modelsQuery.error.message
                        : "Could not load OpenRouter models."}
                    </p>
                  )}
                  {!settingsQuery.data?.provider.api_key_configured && (
                    <p className="text-xs text-muted-foreground">
                      Add the API key to your environment, restart the server, then refresh this page to load models.
                    </p>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSave}
                    disabled={!dirty || saving || !selectedModel.trim()}
                    data-testid="button-save-ai-settings"
                  >
                    {saving ? (
                      <IconLoader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : dirty ? (
                      <IconDeviceFloppy className="h-4 w-4 mr-1" />
                    ) : (
                      <IconCheck className="h-4 w-4 mr-1" />
                    )}
                    {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {showYmlEditor && (
        <Suspense fallback={null}>
          <LlmYmlEditorPanel
            onClose={() => setShowYmlEditor(false)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/admin/ai/settings"] });
              setShowYmlEditor(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
