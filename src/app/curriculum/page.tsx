import Link from "next/link"

const dummyCurricula = [
  {
    id: "design-technology-ks3",
    title: "Design & Technology (KS3)",
    summary:
      "Explore iterative design projects, materials science, and critical making for Key Stage 3 learners.",
  },
]

export default function CurriculumIndexPage() {
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

      <section className="mt-8 grid gap-4">
        {dummyCurricula.map((curriculum) => (
          <Link
            key={curriculum.id}
            href={`/curriculum/${curriculum.id}`}
            className="block rounded-lg border border-border bg-card p-5 shadow-sm transition hover:border-primary hover:shadow"
          >
            <h2 className="text-xl font-semibold text-foreground">{curriculum.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{curriculum.summary}</p>
            <span className="mt-3 inline-flex items-center text-sm font-medium text-primary">
              View curriculum →
            </span>
          </Link>
        ))}
      </section>
    </main>
  )
}
