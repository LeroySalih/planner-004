import Link from "next/link"

import { createCurriculumAction, readCurriculaAction, readSubjectsAction } from "@/lib/server-updates"

async function handleCreateCurriculum(formData: FormData) {
  "use server"

  const title = String(formData.get("title") ?? "")
  const subject = formData.get("subject")
  const description = formData.get("description")

  const result = await createCurriculumAction({
    title,
    subject: subject ? String(subject) : null,
    description: description ? String(description) : null,
  })

  if (result.error) {
    throw new Error(result.error)
  }
}

export default async function CurriculumIndexPage() {
  const [curriculaResult, subjectsResult] = await Promise.all([
    readCurriculaAction(),
    readSubjectsAction(),
  ])

  const curricula = curriculaResult.data ?? []
  const subjects = subjectsResult.data ?? []
  const error = curriculaResult.error

  return (
    <main className="container mx-auto max-w-4xl px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Curricula</p>
        <h1 className="text-3xl font-bold text-primary">Curriculum Explorer</h1>
        <p className="text-muted-foreground">
          Prototype hub for upcoming curriculum tooling. Choose a curriculum below to open its dedicated prototype
          space.
        </p>
      </header>

      <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Create New Curriculum</h2>
        <form action={handleCreateCurriculum} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm font-medium text-muted-foreground">Title *</span>
            <input
              name="title"
              required
              className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="e.g. Design & Technology (KS3)"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted-foreground">Subject</span>
            <select
              name="subject"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              defaultValue=""
            >
              <option value="">No subject</option>
              {subjects.map((subject) => (
                <option key={subject.subject} value={subject.subject}>
                  {subject.subject}
                </option>
              ))}
            </select>
            {subjectsResult.error ? (
              <span className="text-xs text-destructive">{subjectsResult.error}</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm font-medium text-muted-foreground">Description</span>
            <textarea
              name="description"
              className="min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Optional summary for the curriculum"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              Add Curriculum
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Unable to load curricula: {error}
        </div>
      ) : null}

      {curricula.length === 0 && !error ? (
        <div className="mt-8 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No curricula found yet. Once curricula are created they will appear here.
        </div>
      ) : null}

      <section className="mt-8 grid gap-4">
        {curricula.map((curriculum) => (
          <Link
            key={curriculum.curriculum_id}
            href={`/curriculum/${curriculum.curriculum_id}`}
            className="block rounded-lg border border-border bg-card p-5 shadow-sm transition hover:border-primary hover:shadow"
          >
            <h2 className="text-xl font-semibold text-foreground">{curriculum.title}</h2>
            {curriculum.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{curriculum.description}</p>
            ) : null}
            <span className="mt-3 inline-flex items-center text-sm font-medium text-primary">
              View curriculum →
            </span>
          </Link>
        ))}
      </section>
    </main>
  )
}
