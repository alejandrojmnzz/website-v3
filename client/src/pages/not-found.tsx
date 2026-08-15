import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import Staff404Recovery from "@/components/editing/Staff404Recovery";
import { useEditModeOptional } from "@/contexts/EditModeContext";

export default function NotFound() {
  const editMode = useEditModeOptional();
  const isStaff = !!editMode?.isEditMode;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-lg mx-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-404-title">404 Page Not Found</h1>
            </div>

            {!isStaff && (
              <p className="mt-4 text-sm text-muted-foreground" data-testid="text-404-description">
                The page you're looking for doesn't exist or couldn't be loaded.
              </p>
            )}
            <Staff404Recovery />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
