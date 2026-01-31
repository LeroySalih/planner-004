import { PencilRuler } from "lucide-react";
import { LessonActivity } from "@/types";
import { Badge } from "@/components/ui/badge";

interface LessonActivityViewSketchRenderProps {
  activity: LessonActivity;
}

export function LessonActivityViewSketchRender({
  activity,
}: LessonActivityViewSketchRenderProps) {
  const rawBody = (activity.body_data ?? {}) as Record<string, unknown>;
  const instructions =
    typeof rawBody.instructions === "string" ? rawBody.instructions : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <PencilRuler className="h-4 w-4" />
        <span>Render Sketch Activity</span>
      </div>

      {instructions ? (
        <div
          className="prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: instructions }}
        />
      ) : (
        <p className="text-sm italic text-muted-foreground">
          No instructions provided.
        </p>
      )}

       <div className="mt-2 flex items-center gap-2">
           <Badge variant="outline">Scorable</Badge>
           <span className="text-xs text-muted-foreground">Pupils upload a sketch & prompt to generate a new image.</span>
       </div>
    </div>
  );
}
