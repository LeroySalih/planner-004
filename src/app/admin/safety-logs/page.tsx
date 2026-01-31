"use client";

import { useEffect, useState } from "react";
import { getFlaggedSubmissionsAction } from "@/lib/server-actions/admin-safety";
import { type SafetyLogEntry } from "@/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SafetyLogsPage() {
  const [logs, setLogs] = useState<SafetyLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const result = await getFlaggedSubmissionsAction();
      if (result.success && result.data) {
        setLogs(result.data);
      } else {
        setError(result.error || "Failed to fetch logs");
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Safety Logs</h1>
          <p className="text-muted-foreground">
            Review submissions flagged by AI safety guardrails.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <CardTitle>Flagged AI Requests</CardTitle>
          </div>
          <CardDescription>
            These attempts were blocked or flagged due to safety violations (Harassment, Hate Speech, Sexual, Dangerous).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-4 mb-4 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Pupil</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Student Prompt</TableHead>
                  <TableHead>AI Feedback</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No safety issues recorded. Good job!
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.safety_log_id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(log.created_at), "PPP p")}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {log.pupil_first_name} {log.pupil_last_name}
                        </div>
                        <div className="text-xs text-muted-foreground">{log.pupil_email}</div>
                      </TableCell>
                      <TableCell>
                        {log.activity_title || "Unknown Activity"}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="text-sm italic truncate" title={log.prompt || ""}>
                          "{log.prompt || "No prompt"}"
                        </p>
                      </TableCell>
                      <TableCell className="max-w-[250px]">
                        <p className="text-sm text-muted-foreground">
                          {log.ai_model_feedback || "No feedback provided"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive">Blocked</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
