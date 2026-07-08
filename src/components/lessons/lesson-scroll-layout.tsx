"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { ArrowLeft, ChevronDown } from "lucide-react"

export interface ScrollObjectiveCriterion {
  id: string
  title: string
  description: string | null
  level: number | null
}

export interface ScrollObjective {
  id: string
  title: string
  criteria: ScrollObjectiveCriterion[]
}

// The global TopBar is a sticky 80px header, so pinned elements sit just below
// it. The offset is set inline (not via a Tailwind `top-*` utility) so the
// sticky threshold can never go missing to JIT timing — without a `top` value,
// `position: sticky` silently never pins.
const TOP_BAR_HEIGHT = 80

/** Thin progress bar tracking overall page scroll. Render once near the top. */
export function LessonScrollProgress() {
  const progress = useScrollProgress()
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-1 bg-transparent">
      <div
        className="h-full origin-left bg-primary transition-[width] duration-150 ease-out"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  )
}

/** Full-height opening screen: unit → lesson title → objectives + criteria. */
export function LessonHero({
  lessonTitle,
  unitTitle,
  objectives,
  ungroupedCriteria,
  backHref,
  backLabel = "Back",
  greetingName,
}: {
  lessonTitle: string
  unitTitle: string
  objectives: ScrollObjective[]
  ungroupedCriteria: ScrollObjectiveCriterion[]
  backHref?: string
  backLabel?: string
  greetingName?: string | null
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const hasObjectives = objectives.some((o) => o.title) || ungroupedCriteria.length > 0

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      {backHref ? (
        <Link
          href={backHref}
          className="absolute left-6 top-6 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {backLabel}
        </Link>
      ) : null}

      <div
        className={cn(
          "relative w-full max-w-3xl transition-all duration-1000 ease-out",
          mounted ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        )}
      >
        {unitTitle ? (
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            {unitTitle}
          </p>
        ) : null}

        <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          {lessonTitle}
        </h1>

        {greetingName ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Hello {greetingName}, here&apos;s everything you need for this lesson.
          </p>
        ) : null}

        {hasObjectives ? (
          <div className="mx-auto mt-12 max-w-2xl space-y-6 text-left">
            {objectives.map((objective) => (
              <div
                key={objective.id}
                className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Learning objective
                </p>
                <p className="mt-1 text-lg font-semibold">{objective.title}</p>
                {objective.criteria.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {objective.criteria.map((criterion) => (
                      <CriterionRow key={criterion.id} criterion={criterion} />
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}

            {ungroupedCriteria.length > 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Success criteria
                </p>
                <ul className="mt-4 space-y-2">
                  {ungroupedCriteria.map((criterion) => (
                    <CriterionRow key={criterion.id} criterion={criterion} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-muted-foreground transition-opacity duration-1000",
          mounted ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="text-xs font-medium uppercase tracking-widest">Scroll</span>
        <ChevronDown className="h-5 w-5 animate-bounce" />
      </div>
    </section>
  )
}

function CriterionRow({ criterion }: { criterion: ScrollObjectiveCriterion }) {
  return (
    <li className="flex items-start gap-3">
      {criterion.level != null ? (
        <span className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full bg-primary/10 px-2 text-xs font-semibold text-primary">
          L{criterion.level}
        </span>
      ) : (
        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      )}
      <span className="text-sm text-foreground/90">
        {criterion.description?.trim() || criterion.title}
      </span>
    </li>
  )
}

/** Section title that pins below the app TopBar while scrolling its segment. */
export function StickySectionHeading({ title }: { title: string }) {
  return (
    <div
      style={{ position: "sticky", top: TOP_BAR_HEIGHT, zIndex: 30 }}
      className="-mx-6 mb-4 border-b border-border/60 bg-background/90 px-6 py-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
        Section
      </p>
      <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
        {title}
      </h2>
    </div>
  )
}

/**
 * Wraps a single activity in the two-step scroll reveal: the numbered header
 * crosses the trigger line first, then — a little further down — the activity
 * card transitions in from an alternating side.
 */
export function ActivityReveal({
  index,
  total,
  children,
}: {
  index: number
  total: number
  children: React.ReactNode
}) {
  const header = useInView<HTMLDivElement>()
  const card = useInView<HTMLDivElement>()
  const fromLeft = index % 2 === 0

  return (
    <section className="flex min-h-screen scroll-mt-16 flex-col justify-center gap-6 py-[20vh]">
      <div
        ref={header.ref}
        className={cn(
          "flex items-center gap-3 transition-all duration-500 ease-out",
          header.inView ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        )}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {index + 1}
        </span>
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Activity {index + 1} of {total}
        </span>
      </div>

      <div
        ref={card.ref}
        className={cn(
          "rounded-3xl border border-border/60 bg-card p-6 shadow-lg transition-all delay-150 duration-700 ease-out will-change-transform sm:p-8",
          card.inView
            ? "translate-x-0 opacity-100 blur-0"
            : cn("opacity-0 blur-sm", fromLeft ? "-translate-x-16" : "translate-x-16"),
        )}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * Bare scroll-reveal wrapper (no card chrome). The child provides its own card
 * (e.g. a PupilActivityShell), so the card itself is what slides in from an
 * alternating side. Used by the restyled pupil activities.
 */
export function ActivityMotion({
  index,
  id,
  children,
}: {
  index: number
  /** Anchor id for scroll-to (e.g. from the activity sidebar). */
  id?: string
  children: React.ReactNode
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const fromLeft = index % 2 === 0
  return (
    <section className="flex min-h-screen flex-col items-center justify-center py-[16vh]">
      <div
        id={id}
        ref={ref}
        className={cn(
          "w-full max-w-[540px] scroll-mt-24 transition-all duration-700 ease-out will-change-transform",
          inView
            ? "translate-x-0 opacity-100 blur-0"
            : cn("opacity-0 blur-sm", fromLeft ? "-translate-x-16" : "translate-x-16"),
        )}
      >
        {children}
      </div>
    </section>
  )
}

/** Closing celebration screen at the end of the lesson. */
export function LessonEnd() {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <section
      ref={ref}
      className={cn(
        "flex flex-col items-center gap-3 py-16 text-center transition-all duration-700 ease-out",
        inView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-2xl">
        🎉
      </div>
      <p className="text-lg font-semibold">You&apos;ve reached the end</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        That&apos;s the whole lesson. Scroll back up to revisit anything.
      </p>
    </section>
  )
}

/** Track overall page scroll progress (0 → 1). */
function useScrollProgress() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      setProgress(scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0)
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [])

  return progress
}

/** Reveal-on-scroll via IntersectionObserver; stays visible once seen. */
function useInView<T extends Element>({
  rootMargin = "0px 0px -25% 0px",
}: { rootMargin?: string } = {}) {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0, rootMargin },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin])

  return { ref, inView }
}
