"use client"

import { useState } from "react"
import { invokeDigitalOceanAgent } from "./actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Loader2, Terminal, AlertCircle, CheckCircle2 } from "lucide-react"

export default function AgentTestPage() {
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")
  const [result, setResult] = useState<any>(null)
  const [debugData, setDebugData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!input.trim()) return

    setIsLoading(true)
    setStatus("idle")
    setError(null)
    setResult(null)
    setDebugData(null)

    try {
      const response = await invokeDigitalOceanAgent(input)
      setDebugData(response.debug)

      if (response.success) {
        setStatus("success")
        setResult(response.data)
      } else {
        setStatus("error")
        setError(response.error || "Unknown error")
      }
    } catch (e) {
      setStatus("error")
      setError("Failed to invoke action")
    } finally {
      setIsLoading(false)
    }
  }

  const extractAuthor = (data: any): string | null => {
    try {
      if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
        return null
      }
      const content = data.choices[0].message.content
      // Try to parse the content as JSON first
      try {
        const parsed = JSON.parse(content)
        if (parsed.author) return parsed.author
      } catch {
        // If not valid JSON, check if it looks like a JSON object in the string
        const authorMatch = content.match(/"author"\s*:\s*"([^"]+)"/)
        if (authorMatch && authorMatch[1]) {
            return authorMatch[1]
        }
      }
      return null
    } catch (e) {
      return null
    }
  }

  const extractReasoning = (data: any): string | null => {
    try {
      if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
        return null
      }
      return data.choices[0].message.reasoning_content || null
    } catch (e) {
      return null
    }
  }

  const authorName = extractAuthor(result)
  const reasoningContent = extractReasoning(result)

  return (
    <div className="container mx-auto max-w-4xl py-10 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Digital Ocean Agent Test</h1>
          <p className="text-muted-foreground mt-2">
            Test interactions with your configured Digital Ocean GenAI Agent.
          </p>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            {isLoading ? (
                <Badge variant="outline" className="animate-pulse bg-blue-50 text-blue-700 border-blue-200">Processing...</Badge>
            ) : status === "success" ? (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Ready</Badge>
            ) : status === "error" ? (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Error</Badge>
            ) : (
                <Badge variant="outline">Idle</Badge>
            )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
              <CardDescription>Enter the prompt or data to send to the agent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Ask the agent something..."
                className="min-h-[200px] font-mono text-sm"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <Button 
                onClick={handleSubmit} 
                disabled={isLoading || !input.trim()} 
                className="w-full"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "Sending..." : "Submit to Agent"}
              </Button>
              
              {(authorName || reasoningContent) && (
                <div className="mt-4 space-y-4">
                  {authorName && (
                    <div className="p-4 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm transition-all animate-in fade-in slide-in-from-top-1">
                        <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                            Detected Author
                        </span>
                        <span className="text-lg font-medium text-slate-900 dark:text-slate-100">
                            {authorName}
                        </span>
                    </div>
                  )}
                  
                  {reasoningContent && (
                    <div className="p-4 rounded-md bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/50 shadow-sm transition-all animate-in fade-in slide-in-from-top-2">
                        <span className="block text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Terminal className="h-3 w-3" />
                            Reasoning Content
                        </span>
                        <div className="text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80 italic font-serif">
                            {reasoningContent}
                        </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {status === 'error' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle>Response</CardTitle>
              <CardDescription>The data returned by the agent.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-[300px] bg-slate-50 dark:bg-slate-900 rounded-md mx-6 mb-6 p-4 overflow-auto border">
                {result ? (
                    <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                    </pre>
                ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
                        No response data yet.
                    </div>
                )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-dashed">
        <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base font-mono">Debug Console</CardTitle>
            </div>
        </CardHeader>
        <CardContent>
            {debugData ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                    <div className="space-y-1">
                        <span className="text-muted-foreground block">Status</span>
                        <span className={status === 'success' ? 'text-green-600' : 'text-red-600'}>
                            {debugData.status || 'N/A'}
                        </span>
                    </div>
                    <div className="space-y-1">
                        <span className="text-muted-foreground block">Duration</span>
                        <span>{debugData.duration || '0ms'}</span>
                    </div>
                    <div className="space-y-1">
                        <span className="text-muted-foreground block">Endpoint Configured</span>
                        <span>{debugData.endpointConfigured ? 'Yes' : 'No'}</span>
                    </div>
                    <div className="space-y-1">
                        <span className="text-muted-foreground block">Key Configured</span>
                        <span>{debugData.accessKeyConfigured ? 'Yes' : 'No'}</span>
                    </div>
                    {debugData.responseBody && (
                        <div className="col-span-full mt-2 pt-2 border-t">
                            <span className="text-muted-foreground block mb-1">Raw Error Body</span>
                            <pre className="bg-muted p-2 rounded overflow-x-auto">
                                {typeof debugData.responseBody === 'object' 
                                    ? JSON.stringify(debugData.responseBody, null, 2) 
                                    : debugData.responseBody}
                            </pre>
                        </div>
                    )}
                </div>
            ) : (
                <span className="text-xs text-muted-foreground italic">Waiting for request...</span>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
