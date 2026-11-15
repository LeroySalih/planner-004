"use client"

import { useEffect, useRef, useState } from "react"
import { DotGothic16 } from "next/font/google"
import { Music, Pause, Play, X } from "lucide-react"

import { CAROL_GROUPS, CAROLS } from "@/lib/lesson-music/carols"
import type { LessonMusicEngine, LessonMusicParts } from "@/lib/lesson-music/engine"
import { cn } from "@/lib/utils"

const ledFont = DotGothic16({ weight: "400", subsets: ["latin"], display: "swap" })

const STORAGE_KEY = "dino.lessonMusic"

type Saved = { carol: number; volume: number; parts: LessonMusicParts }
const DEFAULTS: Saved = { carol: 0, volume: 60, parts: { sleighBells: false, liftSpeaker: true } }

function readSaved(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const saved = JSON.parse(raw) as Partial<Saved>
    return {
      carol: typeof saved.carol === "number" && CAROLS[saved.carol] ? saved.carol : DEFAULTS.carol,
      volume: typeof saved.volume === "number" ? Math.min(100, Math.max(0, saved.volume)) : DEFAULTS.volume,
      parts: { ...DEFAULTS.parts, ...saved.parts },
    }
  } catch {
    return DEFAULTS
  }
}

function writeSaved(saved: Saved) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Private windows can refuse storage; the music still plays.
  }
}

/**
 * The music-note button at the top of the pupil lesson page. It opens a lift
 * display that plays lift music chosen by the pupil (Christmas carols or
 * all-year classics); the choice is
 * kept in this browser only. Opening is a click, so the browser lets it play.
 */
export function LessonMusic({ className }: { className?: string }) {
  const engineRef = useRef<LessonMusicEngine | null>(null)
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [saved, setSaved] = useState<Saved>(DEFAULTS)
  const [floor, setFloor] = useState(1)

  useEffect(() => setSaved(readSaved()), [])
  useEffect(() => () => engineRef.current?.close(), [])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const update = () => {
      const engine = engineRef.current
      if (engine) setFloor(1 + (Math.floor(engine.currentBeat() / (engine.carol.beatsPerBar * 2)) % 12))
      frame = window.setTimeout(update, 250)
    }
    update()
    return () => window.clearTimeout(frame)
  }, [playing])

  const update = (next: Saved) => {
    setSaved(next)
    writeSaved(next)
  }

  const engine = async () => {
    if (!engineRef.current) {
      const { LessonMusicEngine } = await import("@/lib/lesson-music/engine")
      const created = new LessonMusicEngine()
      created.onCarolChange = (carol) => setSaved((current) => ({ ...current, carol }))
      engineRef.current = created
    }
    return engineRef.current
  }

  const play = async (carol: number) => {
    const music = await engine()
    music.setParts(saved.parts)
    music.setVolume(saved.volume / 100)
    music.play(carol)
    setPlaying(true)
  }

  const stop = () => {
    engineRef.current?.stop()
    setPlaying(false)
  }

  const toggleOpen = () => {
    if (open) {
      stop()
      setOpen(false)
    } else {
      setOpen(true)
      void play(saved.carol)
    }
  }

  const choose = (carol: number) => {
    update({ ...saved, carol })
    void play(carol)
  }

  const setPart = (part: keyof LessonMusicParts) => {
    const parts = { ...saved.parts, [part]: !saved.parts[part] }
    update({ ...saved, parts })
    engineRef.current?.setParts(parts)
  }

  const carol = CAROLS[saved.carol]

  return (
    <>
      <button
        type="button"
        onClick={toggleOpen}
        aria-pressed={open}
        aria-label={open ? "Close lift music" : "Play lift music"}
        title={open ? "Close lift music" : "Play lift music"}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          open && "border-amber-500 text-amber-600 dark:text-amber-400",
          className,
        )}
      >
        <Music className="h-4 w-4" aria-hidden="true" />
      </button>

      {open ? (
        <section
          aria-label="Lift music"
          className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-32px))] rounded-xl border border-zinc-400 bg-gradient-to-b from-zinc-100 via-zinc-200 to-zinc-300 p-4 text-zinc-800 shadow-xl dark:border-zinc-600 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900 dark:text-zinc-100"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Lift music</p>
            <button
              type="button"
              onClick={toggleOpen}
              aria-label="Close lift music"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-amber-500 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div
            className={cn(
              ledFont.className,
              "grid grid-cols-[auto_1fr] items-center gap-x-4 rounded-lg bg-[#1b1206] px-4 py-3 text-[#ffb53d] shadow-[inset_0_2px_10px_rgb(0_0_0/0.6)] [text-shadow:0_0_6px_rgb(255_181_61/0.6)]",
            )}
          >
            <div className="row-span-2 min-w-[2.6ch] text-center text-4xl leading-none tabular-nums">
              <span className={cn("block text-lg transition-opacity", playing ? "opacity-100" : "opacity-30")}>▲</span>
              {playing ? String(floor).padStart(2, "0") : "G"}
            </div>
            <p className="truncate text-lg" aria-live="polite">{carol.name}</p>
            <p className="text-xs text-[#ffb53d]/70">{playing ? `${carol.meta} · going up` : "Doors closed"}</p>
          </div>

          {CAROL_GROUPS.map((group) => (
            <div key={group.id} className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{group.label}</p>
              <div role="group" aria-label={group.label} className="grid grid-cols-4 gap-2">
                {CAROLS.map((item, index) => {
                  if (item.group !== group.id) return null
                  const selected = index === saved.carol
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => choose(index)}
                      aria-pressed={selected}
                      aria-label={item.name}
                      title={item.name}
                      className="group grid justify-items-center gap-1 focus-visible:outline-none"
                    >
                      <span
                        className={cn(
                          ledFont.className,
                          "grid h-12 w-12 place-items-center rounded-full border-[3px] bg-[radial-gradient(circle_at_35%_30%,#f4f4f5,#a1a1aa)] text-lg shadow group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-amber-500 dark:bg-[radial-gradient(circle_at_35%_30%,#52525b,#18181b)]",
                          selected && playing
                            ? "border-amber-500 text-amber-600 shadow-[0_0_12px_rgb(245_158_11/0.55)] dark:text-amber-400"
                            : "border-zinc-400 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400",
                        )}
                      >
                        {item.floor}
                      </span>
                      <span className="line-clamp-2 text-center text-[11px] leading-tight">{item.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="mt-4 flex items-center gap-3 border-t border-zinc-400/60 pt-3 dark:border-zinc-600">
            <button
              type="button"
              onClick={() => (playing ? stop() : void play(saved.carol))}
              aria-label={playing ? "Pause" : "Play"}
              className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-full border-2 border-zinc-400 text-zinc-700 hover:border-amber-500 focus-visible:outline-2 focus-visible:outline-amber-500 dark:border-zinc-600 dark:text-zinc-200"
            >
              {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            </button>
            <label htmlFor="lesson-music-volume" className="sr-only">Volume</label>
            <input
              id="lesson-music-volume"
              type="range"
              min={0}
              max={100}
              value={saved.volume}
              onChange={(event) => {
                const volume = Number(event.target.value)
                update({ ...saved, volume })
                engineRef.current?.setVolume(volume / 100)
              }}
              className="min-w-0 flex-1 accent-amber-500"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ["sleighBells", "Sleigh bells"],
              ["liftSpeaker", "Lift speaker"],
            ] as const).map(([part, label]) => (
              <button
                key={part}
                type="button"
                onClick={() => setPart(part)}
                aria-pressed={saved.parts[part]}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-zinc-400 bg-zinc-50/60 px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-amber-500 dark:border-zinc-600 dark:bg-zinc-800/60"
              >
                <span
                  aria-hidden="true"
                  className={cn("h-2 w-2 rounded-full", saved.parts[part] ? "bg-amber-500 shadow-[0_0_6px_rgb(245_158_11)]" : "bg-zinc-400 dark:bg-zinc-600")}
                />
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
