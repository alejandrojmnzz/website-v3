import { useState, useEffect, useRef } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useSearch, useParams } from "wouter";
import jsYaml from "js-yaml";
import { SectionRenderer } from "@/components/SectionRenderer";
import type { Section } from "@shared/schema";

function sanitizeSectionsForComponentPreview(input: unknown[]): Section[] {
  return input
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => {
      const clone = { ...s };
      // In component preview we don't want geo filters hiding the section.
      delete (clone as { showOnLocations?: unknown }).showOnLocations;
      delete (clone as { showOnRegions?: unknown }).showOnRegions;
      return clone as Section;
    });
}

export default function ComponentPreview() {
  const { componentType } = useParams<{ componentType: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  
  const version = searchParams.get("version") || "v1.0";
  const exampleName = searchParams.get("example");
  const debug = searchParams.get("debug") !== "false";
  /** Screenshot capture: avoid min-h-screen padding so height matches content. */
  const isCapture = searchParams.get("capture") === "1";
  /** Parent (e.g. Theme Editor) sends sections via postMessage; skip sessionStorage to avoid stale data. */
  const embedTheme = searchParams.get("embed") === "theme";
  
  const [sections, setSections] = useState<Section[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const reportHeight = () => {
    if (containerRef.current && window.parent !== window) {
      const height = containerRef.current.scrollHeight;
      window.parent.postMessage({ type: 'preview-height', height }, '*');
    }
  };

  useEffect(() => {
    const isInIframe = window.parent !== window;
    setIsStandalone(!isInIframe);

    if (document.documentElement.classList.contains('dark')) {
      setTheme('dark');
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'preview-update') {
        setSections(sanitizeSectionsForComponentPreview(event.data.sections || []));
        setIsLoading(false);
        setError(null);
      }
      if (event.data?.type === 'theme-update') {
        setTheme(event.data.theme || 'light');
      }
      if (event.data?.type === 'theme-vars-update') {
        const vars = event.data.vars as Record<string, string> | undefined;
        const mode = event.data.mode as 'light' | 'dark' | undefined;
        if (mode) {
          setTheme(mode);
        }
        if (vars) {
          for (const [key, value] of Object.entries(vars)) {
            document.documentElement.style.setProperty(key, value);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);

    if (isInIframe) {
      window.parent.postMessage({ type: 'preview-ready' }, '*');
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (!componentType) {
      setError("Missing component type in URL");
      setIsLoading(false);
      return;
    }

    if (!exampleName) {
      const storedSections = sessionStorage.getItem('preview-sections');
      const storedTheme = sessionStorage.getItem('preview-theme');
      
      if (storedSections) {
        try {
          const parsed = JSON.parse(storedSections);
          const sectionList = Array.isArray(parsed) ? parsed : [parsed];
          setSections(sanitizeSectionsForComponentPreview(sectionList));
          if (storedTheme === 'dark' || storedTheme === 'light') {
            setTheme(storedTheme);
          }
        } catch {
          // Ignore parse errors
        }
      }
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    
    fetch(`/api/component-registry/${componentType}/${version}/examples`)
      .then(res => res.json())
      .then(data => {
        const examples = data.examples || [];
        const example = examples.find((ex: { name: string }) => ex.name === exampleName);
        
        if (!example) {
          setError(`Example "${exampleName}" not found`);
          return;
        }

        try {
          const parsed = jsYaml.load(example.yaml);
          if (Array.isArray(parsed)) {
            setSections(sanitizeSectionsForComponentPreview(parsed));
          } else if (parsed && typeof parsed === 'object') {
            setSections(sanitizeSectionsForComponentPreview([parsed]));
          }
        } catch {
          setError("Failed to parse example YAML");
        }
      })
      .catch(() => setError("Failed to load examples"))
      .finally(() => setIsLoading(false));
  }, [componentType, version, exampleName]);

  useEffect(() => {
    if (sections.length > 0) {
      const modalSection = sections.find(s => s.type === "modal" && s.section_id);
      if (modalSection) {
        window.location.hash = modalSection.section_id!;
      }
      const timeouts = [50, 200, 500, 1000].map(delay => 
        setTimeout(reportHeight, delay)
      );
      return () => timeouts.forEach(clearTimeout);
    }
  }, [sections, reportHeight, componentType]);

  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver(() => {
      reportHeight();
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [reportHeight]);

  const handleGoBack = () => {
    window.history.back();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px] bg-background">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[200px] bg-background text-muted-foreground text-sm">
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-screenshot-root
      className={isCapture ? "bg-background" : "bg-background min-h-screen"}
    >
      {isStandalone && !debug && (
        <div className="fixed top-4 left-4 z-50">
          <button
            onClick={handleGoBack}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-background/80 backdrop-blur border rounded-md shadow-lg hover:bg-muted transition-colors"
            data-testid="button-back-from-preview"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Showcase
          </button>
        </div>
      )}
      {sections.length > 0 ? (
        <SectionRenderer sections={sections} />
      ) : (
        <div className="flex items-center justify-center min-h-[200px] text-muted-foreground text-sm">
          {exampleName ? "No content to display" : "Waiting for content..."}
        </div>
      )}
    </div>
  );
}
