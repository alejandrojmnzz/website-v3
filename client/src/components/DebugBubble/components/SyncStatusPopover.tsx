import { useState } from "react";
import { Check, ExternalLink, Github, Server, Webhook, X } from "lucide-react";
import { useLocation } from "wouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";

interface SyncInfo {
  instanceId: string;
  replitCheckpoint: string;
  githubCommit: string | null;
  repoUrl: string | null;
  env: string;
  pid: number;
  webhook: {
    active: boolean;
    id?: number;
    url?: string;
    createdAt?: string;
  };
  recentLog: Array<{ ts: string; category: string; message: string; person?: string } | string>;
}

interface SyncStatusPopoverProps {
  children: React.ReactNode;
}

export function SyncStatusPopover({ children }: SyncStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  const { data: syncInfo } = useQuery<SyncInfo>({
    queryKey: ["/api/github/sync-info"],
    enabled: open,
    refetchInterval: open ? 10000 : false,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 cursor-pointer" data-testid="button-sync-status-popover">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        side="top"
        align="start"
        sideOffset={8}
      >
        <div className="p-3 border-b">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            <span className="font-semibold text-sm">GitHub Sync Status</span>
          </div>
        </div>

        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Instance</span>
            </div>
            {syncInfo ? (
              <code className="text-xs bg-muted px-2 py-0.5 rounded">
                {syncInfo.instanceId} · {syncInfo.replitCheckpoint}
                {syncInfo.githubCommit && (
                  <>
                    {" · "}
                    {syncInfo.repoUrl ? (
                      <a
                        href={`${syncInfo.repoUrl}/commit/${syncInfo.githubCommit}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground"
                      >
                        gh:{syncInfo.githubCommit}
                      </a>
                    ) : (
                      <>gh:{syncInfo.githubCommit}</>
                    )}
                  </>
                )}
              </code>
            ) : (
              <span className="text-xs text-muted-foreground">--</span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Webhook className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Webhook</span>
            </div>
            {syncInfo?.webhook.active ? (
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <Check className="h-3 w-3" />
                Active (#{syncInfo.webhook.id})
              </span>
            ) : (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <X className="h-3 w-3" />
                Not configured
              </span>
            )}
          </div>
        </div>

        {syncInfo && syncInfo.recentLog.length > 0 && (
          <div className="border-t">
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Activity</span>
            </div>
            <ScrollArea className="h-[140px]">
              <div className="px-3 pb-2 space-y-0.5">
                {syncInfo.recentLog.slice().reverse().map((entry, i) => {
                  let ts: string, cat: string, msg: string;
                  if (typeof entry === "string") {
                    const match = entry.match(/^(\S+)\s+\[(\S+)\]\s+(.+)$/);
                    if (!match) return null;
                    [, ts, cat, msg] = match;
                  } else {
                    ts = entry.ts;
                    cat = entry.category;
                    msg = entry.message;
                  }
                  const time = ts.includes('T') ? ts.split('T')[1]?.replace('Z', '').slice(0, 8) : ts;
                  return (
                    <div key={i} className="text-xs leading-relaxed flex gap-2">
                      <span className="text-muted-foreground shrink-0 tabular-nums">{time}</span>
                      <span className={getCategoryColor(cat)}>[{cat}]</span>
                      <span className="text-foreground break-all">{msg}</span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        <div className="border-t p-2">
          <button
            onClick={() => {
              setOpen(false);
              navigate("/private/repository-sync");
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm hover-elevate"
            data-testid="button-open-sync-log"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Open Full Log</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getCategoryColor(cat: string): string {
  switch (cat) {
    case 'RESTART': return 'text-blue-600 dark:text-blue-400 shrink-0';
    case 'RECONCILE': return 'text-purple-600 dark:text-purple-400 shrink-0';
    case 'WEBHOOK': return 'text-cyan-600 dark:text-cyan-400 shrink-0';
    case 'AUTO-PULL': return 'text-green-600 dark:text-green-400 shrink-0';
    case 'COMMIT': return 'text-emerald-600 dark:text-emerald-400 shrink-0';
    case 'CONFLICT': return 'text-amber-600 dark:text-amber-400 shrink-0';
    case 'ERROR': return 'text-red-600 dark:text-red-400 shrink-0';
    default: return 'text-muted-foreground shrink-0';
  }
}
