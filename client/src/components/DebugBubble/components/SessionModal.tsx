import { useEffect, useState } from "react";
import { Check, Copy, LogOut } from "lucide-react";
import { IconRefresh } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getConsumerToken, clearConsumerToken } from "@/hooks/useAuthUser";

interface SessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: any;
  hasToken: boolean;
  getDebugToken: () => string | null;
  getDebugUserName: () => string | null;
  clearToken: () => void;
  handleCheckSession: () => void;
  isCheckingSession: boolean;
}

interface SessionTokenCardProps {
  title: string;
  token: string | null;
  onLogout: () => void;
  testIdPrefix: string;
}

function SessionTokenCard({ title, token, onLogout, testIdPrefix }: SessionTokenCardProps) {
  const [copied, setCopied] = useState(false);
  const active = !!token;

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid={`card-${testIdPrefix}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
          {active ? (
            <Badge
              className="border-transparent bg-status-online/15 text-status-online"
              data-testid={`badge-${testIdPrefix}-status`}
            >
              Active
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid={`badge-${testIdPrefix}-status`}>
              Inactive
            </Badge>
          )}
        </div>
        {active && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onLogout}
            title={`Log out (destroy ${title.toLowerCase()} token)`}
            data-testid={`button-${testIdPrefix}-logout`}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
      {active ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex-shrink-0">Token</span>
          <code
            className="flex-1 bg-muted px-2 py-1.5 rounded text-xs font-mono truncate"
            data-testid={`text-${testIdPrefix}-token`}
          >
            {token}
          </code>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => {
              navigator.clipboard.writeText(token!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            data-testid={`button-${testIdPrefix}-copy`}
          >
            {copied ? (
              <Check className="h-4 w-4 text-status-online" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No active session.</p>
      )}
    </div>
  );
}

export function SessionModal(props: SessionModalProps) {
  const {
    open,
    onOpenChange,
    session,
    hasToken,
    getDebugToken,
    getDebugUserName,
    clearToken,
    handleCheckSession,
    isCheckingSession,
  } = props;

  // Consumer token kept in state so logout re-renders the card immediately.
  const [consumerToken, setConsumerTokenState] = useState<string | null>(() => getConsumerToken());
  const debugToken = hasToken ? getDebugToken() : null;

  // Re-read on open in case the user logged in/out since the modal mounted.
  useEffect(() => {
    if (open) setConsumerTokenState(getConsumerToken());
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Session Data{getDebugUserName() ? ` - ${getDebugUserName()}` : ''}</DialogTitle>
          <DialogDescription>
            Current session values captured from browser, geolocation, and URL parameters.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SessionTokenCard
              title="Staff Session"
              token={debugToken}
              onLogout={clearToken}
              testIdPrefix="staff-session"
            />

            <SessionTokenCard
              title="Consumer Session"
              token={consumerToken}
              onLogout={() => {
                clearConsumerToken();
                setConsumerTokenState(null);
              }}
              testIdPrefix="consumer-session"
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Geolocation</h4>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Country:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.country || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">City:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.city || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Region:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.region || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.geo?.timezone || 'N/A'}</code>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Device</h4>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.deviceCategory || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">OS:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.osFamily || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Browser:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.browserFamily || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Viewport:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.viewportWidth}x{session.device?.viewportHeight}</code>
              </div>
              <div className="flex justify-between col-span-2">
                <span className="text-muted-foreground">Pixel Ratio:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.device?.devicePixelRatio || 'N/A'}</code>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">UTM Parameters</h4>
            <div className="space-y-1 text-sm">
              {(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_placement', 'utm_plan'] as const).map(key => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground">{key}:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.utm?.[key] || '—'}</code>
                </div>
              ))}
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Tracking</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">PPC Tracking ID:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs max-w-[150px] truncate">{session.utm?.ppc_tracking_id || '—'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Referral:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.utm?.referral || session.utm?.ref || '—'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Coupon:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.utm?.coupon || '—'}</code>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Session Info</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">User ID:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs max-w-[180px] truncate" title={session.userId} data-testid="text-user-id">{session.userId || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Language:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.language}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Browser Lang:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.browserLang || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location Campus:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.location?.slug || 'N/A'}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Initialized:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{session.initialized ? 'Yes' : 'No'}</code>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCheckSession}
            disabled={isCheckingSession}
            data-testid="button-session-refresh"
            title="Check session validity"
          >
            <IconRefresh className={`h-4 w-4 ${isCheckingSession ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-session-modal"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
