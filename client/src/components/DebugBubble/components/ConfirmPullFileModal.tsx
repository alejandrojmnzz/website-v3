import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CloudDownload, File, RefreshCw } from "lucide-react";

interface ConfirmPullFileModalProps {
  confirmPullFile: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  filePulling: string | null;
}

export function ConfirmPullFileModal(props: ConfirmPullFileModalProps) {
  const {
    confirmPullFile,
    onOpenChange,
    onConfirm,
    filePulling,
  } = props;

  return (
    <Dialog open={confirmPullFile !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
              <CloudDownload className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <DialogTitle>Download and Override Local File?</DialogTitle>
              <DialogDescription>
                This will replace your local version with the remote version.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <div className="py-4">
          <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
            <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span 
              className="font-mono text-sm truncate" 
              title={confirmPullFile || ''}
            >
              {confirmPullFile?.replace('4geeks-com/', '')}
            </span>
          </div>
          
          <p className="text-xs text-muted-foreground mt-3">
            Your local version will be replaced with the remote version. This action cannot be undone.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={filePulling === confirmPullFile}
            data-testid="button-cancel-pull-file"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={filePulling === confirmPullFile}
            data-testid="button-confirm-pull-file"
          >
            {filePulling === confirmPullFile ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <CloudDownload className="h-4 w-4 mr-2" />
                Download and Override mine
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
