"use client"

import { useState, useEffect } from "react"
import { extractHandwritingAction, saveHandwritingScanAction } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Loader2, Upload, Save, ScanText } from "lucide-react"

export default function OcrPage() {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [originalText, setOriginalText] = useState<string | null>(null)
  const [editedText, setEditedText] = useState("")
  const [isExtracting, setIsExtracting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [savedSimilarity, setSavedSimilarity] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)
    setOriginalText(null)
    setEditedText("")
    setSavedSimilarity(null)
    setSaveSuccess(false)

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    e.target.value = ""

    const isHeic = file.name.toLowerCase().endsWith(".heic") || file.type === "image/heic" || file.type === "image/heif"
    if (isHeic) {
      try {
        const heic2any = (await import("heic2any")).default
        const convertedBlob = await heic2any({ blob: file, toType: "image/jpeg" })
        const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob
        const jpegFile = new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" })
        setImageFile(jpegFile)
        setPreviewUrl(URL.createObjectURL(jpegFile))
      } catch {
        setImageFile(file)
        setError("Could not generate preview for HEIC file.")
      }
    } else {
      setImageFile(file)
      setPreviewUrl(URL.createObjectURL(file))
    }
  }

  const handleExtract = async () => {
    if (!imageFile) return

    setIsExtracting(true)
    setError(null)
    setSavedSimilarity(null)
    setSaveSuccess(false)

    try {
      const fd = new FormData()
      fd.append("file", imageFile)
      fd.append("mimeType", imageFile.type || "image/jpeg")

      const result = await extractHandwritingAction(fd)
      if (result.success && result.text) {
        setOriginalText(result.text)
        setEditedText(result.text)
      } else {
        setError(result.error || "Failed to extract text.")
      }
    } catch (err) {
      setError("An unexpected error occurred during extraction.")
    } finally {
      setIsExtracting(false)
    }
  }

  const handleSave = async () => {
    if (!imageFile || originalText === null) return

    setIsSaving(true)
    setError(null)

    try {
      const fd = new FormData()
      fd.append("file", imageFile)
      fd.append("fileName", imageFile.name)
      fd.append("mimeType", imageFile.type || "image/jpeg")
      fd.append("originalText", originalText)
      fd.append("editedText", editedText)

      const result = await saveHandwritingScanAction(fd)
      if (result.success) {
        setSavedSimilarity(result.similarity ?? null)
        setSaveSuccess(true)
      } else {
        setError(result.error || "Failed to save scan.")
      }
    } catch (err) {
      setError("An unexpected error occurred while saving.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImageFile(null)
    setPreviewUrl(null)
    setOriginalText(null)
    setEditedText("")
    setSavedSimilarity(null)
    setSaveSuccess(false)
    setError(null)
  }

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-8">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
          Handwriting Recognition
        </h1>
        <p className="text-xl text-muted-foreground">
          Upload a photo of handwritten notes and convert them to digital text.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Left: Image Upload */}
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>Image</CardTitle>
            <CardDescription>Upload a photo of handwritten notes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 flex flex-col">
            <div className="flex-1">
              <Label htmlFor="ocr-upload" className="sr-only">Upload Image</Label>
              <div className="border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center min-h-[350px] bg-muted/50 relative overflow-hidden hover:bg-muted/70 transition-colors">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Uploaded handwriting"
                    className="max-h-full max-w-full object-contain z-10"
                  />
                ) : (
                  <div className="text-center space-y-2 pointer-events-none">
                    <div className="mx-auto w-12 h-12 rounded-full bg-background flex items-center justify-center shadow-sm">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="text-muted-foreground font-medium">Click to upload or drag and drop</div>
                    <div className="text-xs text-muted-foreground/70">PNG, JPG, HEIC supported</div>
                  </div>
                )}

                <Input
                  id="ocr-upload"
                  type="file"
                  accept="image/png, image/jpeg, image/heic"
                  className="absolute inset-0 opacity-0 cursor-pointer h-full w-full z-20"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            <Button
              onClick={handleExtract}
              className="w-full"
              disabled={!imageFile || isExtracting}
              size="lg"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting text...
                </>
              ) : (
                <>
                  <ScanText className="mr-2 h-4 w-4" />
                  Extract Text
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Right: Extracted Text */}
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>Extracted Text</CardTitle>
            <CardDescription>Review and correct the extracted text before saving.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 flex flex-col">
            {originalText !== null ? (
              <>
                <div className="flex-1">
                  <Textarea
                    value={editedText}
                    onChange={(e) => {
                      setEditedText(e.target.value)
                      setSaveSuccess(false)
                    }}
                    className="min-h-[350px] h-full resize-none font-mono text-sm"
                    placeholder="Extracted text will appear here..."
                  />
                </div>

                {savedSimilarity !== null && (
                  <div className="p-3 bg-muted rounded-md text-sm text-center">
                    Similarity score: <span className="font-bold">{(savedSimilarity * 100).toFixed(1)}%</span>
                    {savedSimilarity === 1 ? (
                      <span className="ml-2 text-muted-foreground">- No corrections needed</span>
                    ) : savedSimilarity >= 0.9 ? (
                      <span className="ml-2 text-muted-foreground">- Minor corrections</span>
                    ) : (
                      <span className="ml-2 text-muted-foreground">- Significant corrections</span>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={handleSave}
                    className="flex-1"
                    disabled={isSaving || saveSuccess}
                    size="lg"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : saveSuccess ? (
                      "Saved"
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button onClick={handleReset} variant="outline" size="lg">
                    New Scan
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center text-muted-foreground">
                <div className="space-y-2">
                  <ScanText className="h-12 w-12 mx-auto opacity-20" />
                  <p>Upload an image and click Extract Text</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md font-medium text-center">
          {error}
        </div>
      )}
    </div>
  )
}
