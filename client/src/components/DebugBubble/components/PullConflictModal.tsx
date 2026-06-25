import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, ArrowUp, CloudDownload, File } from "lucide-react";

interface PullConflictModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pullConflictFiles: string[];
  onCommitFirst: () => void;
  onPullAnyway: () => void;
}

export function PullConflictModal(props: PullConflictModalProps) {
  const {
    open,
    onOpenChange,
    pullConflictFiles,
    onCommitFirst,
    onPullAnyway,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <DialogTitle>Conflicting Files Detected</DialogTitle>
              <DialogDescription>
                The following files have been modified both locally and on remote.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <div className="py-4">
          <ScrollArea className="max-h-[200px] border rounded-md">
            <div className="p-2 space-y-1">
              {pullConflictFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span 
                    className="font-mono text-xs truncate" 
                    title={file}
                  >
                    {file.replace('4geeks-com/', '')}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
          
          <p className="text-xs text-muted-foreground mt-3">
            Pulling will overwrite your local changes to these files.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-pull"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={onCommitFirst}
            data-testid="button-commit-first"
          >
            <ArrowUp className="h-4 w-4 mr-2" />
            Commit First
          </Button>
          <Button
            variant="destructive"
            onClick={onPullAnyway}
            data-testid="button-pull-anyway"
          >
            <CloudDownload className="h-4 w-4 mr-2" />
            Pull Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
