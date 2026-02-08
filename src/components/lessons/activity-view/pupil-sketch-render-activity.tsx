"use client";

import { useState, useTransition, useRef } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, Sparkles, RefreshCcw } from "lucide-react";
import { 
    saveSketchRenderAnswerAction, 
    renderSketchServerAction 
} from "@/lib/server-actions/sketch-render-activity";
import type { LessonActivity } from "@/types";



interface PupilSketchRenderActivityProps {
    activity: LessonActivity;
    userId: string;
    submission: any; // Type accurately if possible, else any
    assignmentId?: string;
}

export function PupilSketchRenderActivity({
    activity,
    userId,
    submission,
    assignmentId
}: PupilSketchRenderActivityProps) {
    const [isPending, startTransition] = useTransition();
    const [prompt, setPrompt] = useState(submission?.body?.prompt || "");
    const [originalFile, setOriginalFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(
        submission?.body?.original_file_path
        ? `/api/activity-files/download?lessonId=${activity.lesson_id}&activityId=${activity.activity_id}&fileName=${submission.body.original_file_path}&userId=${userId}`
        : null
    );
    const [renderedUrl, setRenderedUrl] = useState<string | null>(
        submission?.body?.rendered_file_path
        ? `/api/activity-files/download?lessonId=${activity.lesson_id}&activityId=${activity.activity_id}&fileName=${submission.body.rendered_file_path}&userId=${userId}`
        : null
    );
    const [isDragging, setIsDragging] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = async (file: File) => {
        const fileType = file.type.toLowerCase();
        const fileName = file.name.toLowerCase();

        if (fileType === "image/heic" || fileType === "image/heif" || fileName.endsWith(".heic") || fileName.endsWith(".heif")) {
            try {
                toast.info("Converting raw image format...");
                const heic2any = (await import("heic2any")).default;
                const convertedBlob = await heic2any({
                    blob: file,
                    toType: "image/jpeg",
                });


                const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
                const newFile = new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
                    type: "image/jpeg",
                });

                setOriginalFile(newFile);
                setPreviewUrl(URL.createObjectURL(newFile));
                setRenderedUrl(null);
            } catch (error) {
                console.error("HEIC conversion failed", error);
                toast.error("Failed to process image. Please try a standard JPEG or PNG.");
            }
        } else {
             setOriginalFile(file);
             setPreviewUrl(URL.createObjectURL(file));
             setRenderedUrl(null);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            processFile(file);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const file = e.dataTransfer.files?.[0];
        if (file && (file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".heic"))) {
            processFile(file);
        } else if (file) {
            toast.error("Please upload an image file");
        }
    };

    const handleSave = () => {
        if (!originalFile && !submission?.body?.original_file_path) {
            toast.error("Please upload a sketch first.");
            return;
        }

        const formData = new FormData();
        formData.append("activityId", activity.activity_id);
        formData.append("userId", userId);
        if (assignmentId) formData.append("assignmentId", assignmentId);
        formData.append("prompt", prompt);
        if (originalFile) formData.append("originalFile", originalFile);

        startTransition(async () => {
            const result = await saveSketchRenderAnswerAction(formData);
            if (result.success) {
                toast.success("Saved successfully");
            } else {
                toast.error(result.error || "Failed to save");
            }
        });
    };

    const handleRender = () => {
         // Ensure saved first? Or save and render in one go? 
         // For now, let's assume they must save first implicitly or we do it.
         // Let's do a save-first approach if new file.
        
        startTransition(async () => {
            // 1. Save if needed (if new file or prompt changed)
            if (originalFile || prompt !== submission?.body?.prompt) {
                 const formData = new FormData();
                formData.append("activityId", activity.activity_id);
                formData.append("userId", userId);
                if (assignmentId) formData.append("assignmentId", assignmentId);
                formData.append("prompt", prompt);
                if (originalFile) formData.append("originalFile", originalFile);
                
                const saveResult = await saveSketchRenderAnswerAction(formData);
                if (!saveResult.success) {
                    toast.error(saveResult.error || "Failed to save before rendering");
                    return;
                }
            }

            // 2. Trigger Render
            toast.info("AI is rendering your sketch... this may take a moment.");
            const renderResult = await renderSketchServerAction(activity.activity_id, userId);

            if (renderResult.success) {
                toast.success("Sketch rendered!");
                const body = renderResult.data?.body as any;
                if (body?.rendered_file_path) {
                     setRenderedUrl(`/api/activity-files/download?lessonId=${activity.lesson_id}&activityId=${activity.activity_id}&fileName=${body.rendered_file_path}&userId=${userId}&t=${Date.now()}`);
                }
            } else {
                toast.error(renderResult.error || "Rendering failed");
            }
        });
    };

    const instructions = (activity.body_data as any)?.instructions;

    return (
        <div className="space-y-6">
            <div className="prose dark:prose-invert max-w-none">
                <h3>{activity.title}</h3>
                {instructions && <div dangerouslySetInnerHTML={{ __html: instructions }} />}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Col: Upload & Prompt */}
                <div className="space-y-4 border p-4 rounded-lg bg-card text-card-foreground">
                    <h4 className="font-semibold flex items-center gap-2">
                        <Upload className="w-4 h-4" /> Your Sketch
                    </h4>
                    
                    <div 
                        className={`border-2 border-dashed rounded-md h-64 flex flex-col items-center justify-center cursor-pointer transition-colors relative overflow-hidden ${isDragging ? "border-primary bg-primary/5" : "hover:bg-muted/50 border-border"}`}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                         {previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img 
                                src={previewUrl} 
                                alt="Sketch preview" 
                                className="object-contain h-full w-full p-2"
                            />
                        ) : (
                            <div className="text-muted-foreground text-center p-4">
                                <p>Click or drag & drop to upload a photo of your sketch</p>
                            </div>
                        )}
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            accept="image/*" 
                            onChange={handleFileChange} 
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Prompt (Describe your sketch for the AI)</Label>
                        <Textarea 
                            placeholder="e.g. A futuristic farm house with solar panels..." 
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2">
                         <Button onClick={handleSave} disabled={isPending} variant="outline" className="flex-1">
                            Save Draft
                         </Button>
                         <Button onClick={handleRender} disabled={isPending || (!originalFile && !submission?.body?.original_file_path)} className="flex-1">
                            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                            Render with Gemini
                         </Button>
                    </div>
                </div>

                {/* Right Col: Result */}
                <div className="space-y-4 border p-4 rounded-lg bg-card text-card-foreground">
                     <h4 className="font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-500" /> AI Result
                    </h4>
                    
                    <div className="border rounded-md h-[400px] flex items-center justify-center bg-muted/20 relative overflow-hidden">
                        {renderedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img 
                                src={renderedUrl} 
                                alt="Rendered result" 
                                className="object-contain h-full w-full"
                            />
                        ) : (
                            <div className="text-muted-foreground text-center p-6 space-y-2">
                                <Sparkles className="w-12 h-12 mx-auto opacity-20" />
                                <p>Rendered image will appear here</p>
                            </div>
                        )}
                    </div>
                    {renderedUrl && (
                        <p className="text-xs text-muted-foreground text-center">
                            AI generated images may vary. Try adjusting your prompt for different results.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
