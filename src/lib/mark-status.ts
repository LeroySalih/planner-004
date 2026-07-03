import type { MarkStatus } from "@/dino.config";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function markStatusLabel(
  status: MarkStatus | null | undefined,
  markedAt?: string | null,
): { label: string; tone: "pending" | "active" | "done" | "error" } {
  switch (status) {
    case "waiting":
      return { label: "Waiting…", tone: "pending" };
    case "reading":
      return { label: "Reading…", tone: "active" };
    case "marking":
      return { label: "Marking…", tone: "active" };
    case "marked":
      return {
        label: markedAt ? `Marked ${formatDate(markedAt)}` : "Marked",
        tone: "done",
      };
    case "reading-error":
      return { label: "Reading error", tone: "error" };
    case "marking-error":
      return { label: "Marking error", tone: "error" };
    default:
      return { label: "—", tone: "pending" };
  }
}
