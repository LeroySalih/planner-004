"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTransition } from "react";
import { toast } from "sonner";
import { createWeeklyPlanNoteAction } from "@/lib/server-updates";
import { Button } from "@/components/ui/button";

type Props = {
  groupId: string;
  weekStartDate: string;
  initialContent?: string;
  onSaved?: () => void;
};

export function NoteEditor({ groupId, weekStartDate, initialContent, onSaved }: Props) {
  const [isPending, startTransition] = useTransition();

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert min-h-[80px] max-w-none p-3 focus:outline-none",
      },
    },
  });

  const handleSave = () => {
    if (!editor) return;
    const html = editor.getHTML();
    startTransition(async () => {
      const { error } = await createWeeklyPlanNoteAction(groupId, weekStartDate, html);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Note saved");
      onSaved?.();
    });
  };

  return (
    <div className="border rounded-md bg-background">
      <div className="border-b px-3 py-1.5 flex gap-1 text-xs text-muted-foreground">
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={editor?.isActive("bold") ? "font-bold px-1 text-foreground" : "font-bold px-1"}
        >
          B
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={editor?.isActive("italic") ? "italic px-1 text-foreground" : "italic px-1"}
        >
          I
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={editor?.isActive("bulletList") ? "px-1 text-foreground" : "px-1"}
        >
          • List
        </button>
      </div>
      <EditorContent editor={editor} />
      <div className="border-t px-3 py-2 flex justify-end">
        <Button size="sm" disabled={isPending || !editor} onClick={handleSave}>
          {isPending ? "Saving..." : "Save note"}
        </Button>
      </div>
    </div>
  );
}
