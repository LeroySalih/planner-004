"use client"

import { useEffect, useRef } from "react"
import { AlignJustify, Bold, Code, Italic } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface RichTextEditorProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  onBlur?: () => void
}

export function RichTextEditor({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  onBlur,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = editorRef.current
    if (!element) return

    const current = element.innerHTML
    if (normalizeHtml(current) !== normalizeHtml(value)) {
      element.innerHTML = value || ""
    }
  }, [value])

  useEffect(() => {
    const element = editorRef.current
    if (!element) return

    const handleInput = () => {
      onChange(element.innerHTML)
    }

    element.addEventListener("input", handleInput)
    return () => {
      element.removeEventListener("input", handleInput)
    }
  }, [onChange])

  const exec = (command: string, valueArg?: string) => {
    if (disabled) return
    editorRef.current?.focus()
    document.execCommand(command, false, valueArg)
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  const insertCodeBlock = () => {
    if (disabled) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const content = range.toString()
    const wrapper = document.createElement("pre")
    const code = document.createElement("code")
    code.textContent = content || "code"
    wrapper.appendChild(code)
    range.deleteContents()
    range.insertNode(wrapper)
    range.selectNode(wrapper)
    selection.removeAllRanges()
    selection.addRange(range)
    editorRef.current?.focus()
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <ToolbarButton icon={Bold} label="Bold" onClick={() => exec("bold")} disabled={disabled} />
        <ToolbarButton icon={Italic} label="Italic" onClick={() => exec("italic")} disabled={disabled} />
        <ToolbarButton
          icon={AlignJustify}
          label="Justify"
          onClick={() => exec("justifyFull")}
          disabled={disabled}
        />
        <ToolbarButton icon={Code} label="Code block" onClick={insertCodeBlock} disabled={disabled} />
      </div>
      <div
        id={id}
        ref={editorRef}
        className={cn(
          "min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          disabled && "pointer-events-none opacity-60",
          "prose prose-sm max-w-none",
          className,
        )}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onBlur={onBlur}
      />
      <style jsx>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Bold
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  )
}

function normalizeHtml(content: string) {
  return content.replace(/\s+/g, " ").trim()
}
