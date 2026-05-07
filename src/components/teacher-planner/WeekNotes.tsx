type WeekNotesProps = {
  value: string
  onChange: (val: string) => void
}

export function WeekNotes({ value, onChange }: WeekNotesProps) {
  return (
    <div className="mt-5">
      <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5">
        Week notes
      </label>
      <textarea
        className="w-full min-h-[60px] resize-y rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2.5 py-2 text-xs text-[var(--color-text-primary)] leading-relaxed focus:outline-none focus:border-[var(--color-border-info)] focus:ring-1 focus:ring-[var(--color-border-info)]/20"
        placeholder="Reminders for the week — assemblies, observations, deadlines…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
