import Link from "next/link"

import { CreateCurriculumSheet } from "./_components/create-curriculum-sheet"
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Create New Curriculum</h2>
            <p className="text-sm text-muted-foreground">
              Launch the sidebar to capture the curriculum details.
            </p>
          </div>
          <CreateCurriculumSheet
            action={handleCreateCurriculum}
            subjects={subjects}
            subjectsError={subjectsResult.error}
          />
        </div>
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
