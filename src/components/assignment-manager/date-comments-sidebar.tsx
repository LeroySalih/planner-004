"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, Pencil, Trash2 } from "lucide-react"
import type { DateComment, DateComments } from "@/types"

interface DateCommentsSidebarProps {
  isOpen: boolean
  onClose: () => void
  selectedDate: string | null
  comments: DateComments
  onCreate: (commentDate: string, comment: string) => void
  onUpdate: (dateCommentId: string, comment: string) => void
  onDelete: (dateCommentId: string) => void
}

export function DateCommentsSidebar({
  isOpen,
  onClose,
  selectedDate,
  comments,
  onCreate,
  onUpdate,
  onDelete,
}: DateCommentsSidebarProps) {
  const [newComment, setNewComment] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setNewComment("")
    setEditingId(null)
    setEditingText("")
    setConfirmDeleteId(null)
  }, [selectedDate])

  const handleCreate = () => {
    const trimmed = newComment.trim()
    if (!trimmed || !selectedDate) return
    onCreate(selectedDate, trimmed)
    setNewComment("")
  }

  const handleUpdate = (dateCommentId: string) => {
    const trimmed = editingText.trim()
    if (!trimmed) return
    onUpdate(dateCommentId, trimmed)
    setEditingId(null)
    setEditingText("")
  }

  const handleDelete = (dateCommentId: string) => {
    if (confirmDeleteId !== dateCommentId) {
      setConfirmDeleteId(dateCommentId)
      return
    }
    onDelete(dateCommentId)
    setConfirmDeleteId(null)
  }

  const startEditing = (comment: DateComment) => {
    setEditingId(comment.date_comment_id)
    setEditingText(comment.comment)
    setConfirmDeleteId(null)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingText("")
  }

  const formatDisplayDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-")
    return `${day}-${month}-${year}`
  }

  if (!isOpen || !selectedDate) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative ml-auto w-96 bg-background shadow-xl border-l">
        <Card className="h-full rounded-none border-0 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">
              Comments for {formatDisplayDate(selectedDate)}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto space-y-4">
            {comments.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments for this date yet.</p>
            )}

            {comments.map((comment) => (
              <div
                key={comment.date_comment_id}
                className="rounded-md border border-border p-3 space-y-2"
              >
                {editingId === comment.date_comment_id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleUpdate(comment.date_comment_id)}
                        disabled={!editingText.trim()}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelEditing}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{comment.comment}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {new Date(comment.created_at).toLocaleString()}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => startEditing(comment)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 w-7 p-0 ${confirmDeleteId === comment.date_comment_id ? "text-destructive" : ""}`}
                          onClick={() => handleDelete(comment.date_comment_id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {confirmDeleteId === comment.date_comment_id && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                        Click the delete button again to confirm.
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            <div className="space-y-2 pt-2 border-t border-border">
              <textarea
                ref={textareaRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <Button
                onClick={handleCreate}
                disabled={!newComment.trim()}
                className="w-full"
                size="sm"
              >
                Add Comment
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
