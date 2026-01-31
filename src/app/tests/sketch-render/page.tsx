"use client";

import { useState } from "react";
import Image from "next/image";
import { renderSketchAction } from "@/lib/server-actions/sketch-render";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
// import heic2any from "heic2any"; // Removed top-level import to fix SSR error
import { Loader2, Upload } from "lucide-react";

export default function SketchRenderPage() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isRenderLoading, setIsRenderLoading] = useState(false);
  const [isFileProcessing, setIsFileProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper to read file as Data URL
  const readFileAsDataURL = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("File selected:", file.name, file.type);
    setError(null);
    setResultImage(null);

    // Timeout helper
    const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
      ]);
    };

    try {
      setIsFileProcessing(true);
      let processFile = file;

      // Convert HEIC if needed
      if (file.name.toLowerCase().endsWith(".heic")) {
        console.log("Detected HEIC, starting conversion...");
        // Dynamically import heic2any to avoid SSR "window is not defined" error
        const heicLoader = import("heic2any");
        // Wait max 10s for module load
        const heic2anyLib = (await withTimeout(heicLoader, 10000, "Failed to load heic2any module")).default;
        
        console.log("Module loaded, converting...");
        const conversionPromise = heic2anyLib({
          blob: file,
          toType: "image/jpeg",
          quality: 0.8,
        });

        // Wait max 30s for conversion
        const converted = await withTimeout(conversionPromise, 30000, "HEIC conversion timed out");
        console.log("HEIC conversion successful", converted);

        // heic2any can return array or blob
        const blob = Array.isArray(converted) ? converted[0] : converted;
        processFile = new File([blob], file.name.replace(/\.heic$/i, ".jpg"), {
          type: "image/jpeg",
        });
      }

      console.log("Reading file as Data URL...");
      // Convert to Base64 for display and sending
      // Wait max 10s for file reading
      const dataUrl = await withTimeout(readFileAsDataURL(processFile), 10000, "File reading timed out");
      setSelectedImage(dataUrl);
      console.log("File read complete");
      
    } catch (err: any) {
      console.error("File processing error:", err);
      setError(err?.message || "Failed to process image. Please try a different file.");
    } finally {
      setIsFileProcessing(false);
      // Reset the input value so the same file can be selected again if needed
      e.target.value = "";
    }
  };

  const handleRender = async () => {
    if (!selectedImage || !prompt) return;

    setIsRenderLoading(true);
    setError(null);

    try {
      const result = await renderSketchAction(selectedImage, prompt);

      if (result.success && result.image) {
        setResultImage(result.image);
      } else {
        setError(result.error || "Failed to render image.");
      }
    } catch (err) {
      console.error("Action error:", err);
      setError("An unexpected error occurred.");
    } finally {
      setIsRenderLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-8">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
          Sketch to Image
        </h1>
        <p className="text-xl text-muted-foreground">
          Turn your rough sketches into polished images using Gemini AI.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Input Section */}
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>Input</CardTitle>
            <CardDescription>Upload your sketch and describe the target look.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 flex-1 flex flex-col">
            
            {/* File Upload Area */}
            <div className="grid w-full items-center gap-1.5 flex-1">
              <Label htmlFor="sketch-upload" className="sr-only">Upload Sketch</Label>
              <div className="flex-1 border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center min-h-[300px] bg-muted/50 relative overflow-hidden group hover:bg-muted/70 transition-colors">
                
                {selectedImage ? (
                  <img 
                    src={selectedImage} 
                    alt="Original Sketch" 
                    className="max-h-full max-w-full object-contain z-10" 
                  />
                ) : (
                  <div className="text-center space-y-2 pointer-events-none">
                     {isFileProcessing ? (
                       <div className="flex flex-col items-center justify-center space-y-2">
                         <Loader2 className="h-8 w-8 animate-spin text-primary" />
                         <p className="text-sm font-medium">Processing image...</p>
                       </div>
                     ) : (
                       <>
                         <div className="mx-auto w-12 h-12 rounded-full bg-background flex items-center justify-center shadow-sm">
                            <Upload className="h-6 w-6 text-muted-foreground" />
                         </div>
                         <div className="text-muted-foreground font-medium">Click to upload or drag and drop</div>
                         <div className="text-xs text-muted-foreground/70">PNG, JPG, HEIC supported</div>
                       </>
                     )}
                  </div>
                )}

                <Input
                  id="sketch-upload"
                  type="file"
                  accept="image/png, image/jpeg, image/heic"
                  className="absolute inset-0 opacity-0 cursor-pointer h-full w-full z-20"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {/* Prompt Input */}
            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Input
                id="prompt"
                placeholder="E.g., A photorealistic landscape with mountains..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <Button 
                onClick={handleRender} 
                className="w-full" 
                disabled={!selectedImage || !prompt || isRenderLoading || isFileProcessing}
                size="lg"
            >
              {isRenderLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rendering...
                </>
              ) : (
                "Render Sketch"
              )}
            </Button>
            
            {error && (
                <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md font-medium text-center">
                    {error}
                </div>
            )}

          </CardContent>
        </Card>

        {/* Output Section */}
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>Result</CardTitle>
            <CardDescription>Your AI-generated image will appear here.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center min-h-[400px] bg-muted/20 rounded-lg p-2">
            {resultImage ? (
               <div className="relative w-full h-full flex items-center justify-center">
                  <img 
                    src={resultImage} 
                    alt="Rendered Result" 
                    className="max-h-full max-w-full object-contain rounded shadow-sm" 
                  />
               </div>
            ) : (
               <div className="text-center text-muted-foreground space-y-2">
                  <div className="text-6xl opacity-20">✨</div>
                  <p>Ready to create magic</p>
               </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
