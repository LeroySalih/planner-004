"use client"

import { useMemo, useState } from "react"
import { invokeAiMarking } from "./actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Terminal, AlertCircle } from "lucide-react"

export default function AgentTestPage() {
  const [question, setQuestion] = useState("Describe a metal that is a good choice or making car bodies")
  const [modelAnswer, setModelAnswer] = useState("Aluminium is a good choice as it is maleable, and there can be beaten in the shapes needed for car bodies")
  const [pupilAnswer, setPupilAnswer] = useState("Aluminium is maleable so it can be beaten to make a car")
  
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")
  const [result, setResult] = useState<any>(null)
  const [debugData, setDebugData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setIsLoading(true)
    setStatus("idle")
    setError(null)
    setResult(null)
    setDebugData(null)

    try {
      const response = await invokeAiMarking({
        question,
        model_answer: modelAnswer,
        pupil_answer: pupilAnswer
      })
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

  const parsedResult = useMemo(() => {
    if (!result) return null;

    // Check if result has the structure { body: { result: "..." } }
    if (result.body && typeof result.body.result === 'string') {
      try {
        return JSON.parse(result.body.result);
      } catch (e) {
        console.error("Failed to parse nested result string", e);
      }
    }

    // Check if result has the structure { result: "..." }
    if (typeof result.result === 'string') {
      try {
        return JSON.parse(result.result);
      } catch (e) {
        console.error("Failed to parse result string", e);
      }
    }

    return result;
  }, [result]);

  const isFormValid = question.trim() && modelAnswer.trim() && pupilAnswer.trim()

  return (
    <div className="container mx-auto max-w-6xl py-10 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Marking Test</h1>
          <p className="text-muted-foreground mt-2">
            Test the AI marking function with question, model answer, and pupil response.
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
        {/* Left Column: Inputs */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Input Data</CardTitle>
              <CardDescription>Provide the context for marking.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="question">Question</Label>
                <Input
                  id="question"
                  placeholder="Enter the question..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="modelAnswer">Model Answer</Label>
                <Textarea
                  id="modelAnswer"
                  placeholder="Enter the ideal model answer..."
                  className="min-h-[100px] text-sm"
                  value={modelAnswer}
                  onChange={(e) => setModelAnswer(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pupilAnswer">Pupil Answer</Label>
                <Textarea
                  id="pupilAnswer"
                  placeholder="Enter the pupil's response..."
                  className="min-h-[100px] text-sm"
                  value={pupilAnswer}
                  onChange={(e) => setPupilAnswer(e.target.value)}
                />
              </div>

              <Button 
                onClick={handleSubmit} 
                disabled={isLoading || !isFormValid} 
                className="w-full"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "Marking..." : "Submit for Marking"}
              </Button>
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

        {/* Right Column: Output Tabs */}
        <div className="space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle>Output</CardTitle>
              <CardDescription>Review the marking results and raw response.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <Tabs defaultValue="result" className="h-full flex flex-col">
                <div className="px-6 border-b">
                  <TabsList className="w-full justify-start rounded-none h-12 bg-transparent p-0">
                    <TabsTrigger 
                      value="result" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-12 px-4"
                    >
                      Result
                    </TabsTrigger>
                    <TabsTrigger 
                      value="response"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-12 px-4"
                    >
                      Raw Response
                    </TabsTrigger>
                  </TabsList>
                </div>
                
                <div className="flex-1 p-6">
                  <TabsContent value="result" className="m-0 focus-visible:ring-0">
                    {parsedResult ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4 p-4 rounded-lg bg-slate-50 border">
                          <div className="space-y-1">
                            <span className="text-xs font-semibold uppercase text-muted-foreground">Score</span>
                            <div className="text-3xl font-bold">
                              {typeof parsedResult.score === 'number' ? `${(parsedResult.score * 100).toFixed(0)}%` : 'N/A'}
                            </div>
                          </div>
                        </div>
                        
                        {parsedResult.feedback && (
                          <div className="space-y-2">
                            <span className="text-xs font-semibold uppercase text-muted-foreground">Feedback</span>
                            <div className="p-4 rounded-lg bg-blue-50/50 border border-blue-100 text-blue-900 text-sm leading-relaxed italic">
                              {parsedResult.feedback}
                            </div>
                          </div>
                        )}

                        {parsedResult.reasoning && (
                          <div className="space-y-2">
                            <span className="text-xs font-semibold uppercase text-muted-foreground">Reasoning</span>
                            <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 text-slate-700 text-xs leading-relaxed">
                              {parsedResult.reasoning}
                            </div>
                          </div>
                        )}

                        {parsedResult.results && Array.isArray(parsedResult.results) && parsedResult.results[0] && (
                           <div className="mt-4 p-4 border rounded-lg bg-amber-50/30">
                              <p className="text-xs font-bold text-amber-800 uppercase mb-2">Detailed Results (First Pupil)</p>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <span className="text-[10px] text-muted-foreground uppercase">Score</span>
                                  <p className="font-semibold">{parsedResult.results[0].score}</p>
                                </div>
                                <div>
                                  <span className="text-[10px] text-muted-foreground uppercase">Pupil ID</span>
                                  <p className="font-mono text-[10px] truncate">{parsedResult.results[0].pupilid}</p>
                                </div>
                              </div>
                              <div className="mt-2">
                                <span className="text-[10px] text-muted-foreground uppercase">Feedback</span>
                                <p className="text-xs italic mt-1">{parsedResult.results[0].feedback}</p>
                              </div>
                           </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm italic py-20">
                        No result yet.
                      </div>
                    )}
                  </TabsContent>
                  
                  <TabsContent value="response" className="m-0 focus-visible:ring-0">
                    <div className="bg-slate-950 rounded-md p-4 overflow-auto border max-h-[500px]">
                      {result ? (
                        <pre className="text-xs font-mono whitespace-pre-wrap text-slate-300">
                          {JSON.stringify(result, null, 2)}
                        </pre>
                      ) : (
                        <div className="flex items-center justify-center text-slate-500 text-sm italic py-20">
                          No response data yet.
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Debug Console at bottom */}
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
                        <span className="text-muted-foreground block">Endpoint</span>
                        <span className="truncate block" title={debugData.url}>{debugData.url || 'N/A'}</span>
                    </div>
                    <div className="space-y-1">
                        <span className="text-muted-foreground block">Payload</span>
                        <span>{debugData.input ? 'Present' : 'None'}</span>
                    </div>
                    {debugData.responseBody && (
                        <div className="col-span-full mt-2 pt-2 border-t">
                            <span className="text-muted-foreground block mb-1">Response Body (Truncated)</span>
                            <pre className="bg-muted p-2 rounded overflow-x-auto max-h-40">
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