// Lift music for the pupil lesson page: public-domain carols and classics,
// synthesised in the browser by `engine.ts`, so there are no audio files and
// nothing to license. A melody is [midi | null, beats]; chords are
// [name, beats]; both cover the same number of beats.

export type CarolStyle = "bossa" | "waltz"

export type CarolGroup = "christmas" | "all-year"

export const CAROL_GROUPS: Array<{ id: CarolGroup; label: string }> = [
  { id: "christmas", label: "Christmas" },
  { id: "all-year", label: "All year" },
]

export type Carol = {
  id: string
  name: string
  group: CarolGroup
  meta: string
  floor: number
  bpm: number
  beatsPerBar: number
  style: CarolStyle
  transpose: number
  melody: Array<[number | null, number]>
  chords: Array<[string, number]>
}

export const CAROLS: Carol[] = [
  {
    id: "jingle-bells", name: "Jingle Bells", group: "christmas", meta: "Bossa · G", floor: 1, bpm: 104, beatsPerBar: 4, style: "bossa", transpose: 0,
    melody: [
      [71, 1], [71, 1], [71, 2], [71, 1], [71, 1], [71, 2], [71, 1], [74, 1], [67, 1.5], [69, 0.5], [71, 4],
      [72, 1], [72, 1], [72, 1.5], [72, 0.5], [72, 1], [71, 1], [71, 1], [71, 0.5], [71, 0.5], [71, 1], [69, 1], [69, 1], [71, 1], [69, 2], [74, 2],
      [71, 1], [71, 1], [71, 2], [71, 1], [71, 1], [71, 2], [71, 1], [74, 1], [67, 1.5], [69, 0.5], [71, 4],
      [72, 1], [72, 1], [72, 1.5], [72, 0.5], [72, 1], [71, 1], [71, 1], [71, 0.5], [71, 0.5], [74, 1], [74, 1], [72, 1], [69, 1], [67, 4],
    ],
    chords: [
      ["Gmaj7", 4], ["Em7", 4], ["Am7", 4], ["D7", 4], ["Cmaj7", 4], ["Gmaj7", 4], ["A7", 4], ["D7", 4],
      ["Gmaj7", 4], ["Em7", 4], ["Am7", 4], ["D7", 4], ["Cmaj7", 4], ["Gmaj7", 4], ["Am7", 2], ["D7", 2], ["G6", 4],
    ],
  },
  {
    id: "deck-the-halls", name: "Deck the Halls", group: "christmas", meta: "Bossa · G", floor: 2, bpm: 100, beatsPerBar: 4, style: "bossa", transpose: 0,
    melody: [
      [74, 1.5], [72, 0.5], [71, 1], [69, 1], [67, 1], [69, 1], [71, 1], [67, 1], [69, 0.5], [71, 0.5], [72, 0.5], [69, 0.5], [71, 1.5], [69, 0.5], [67, 1], [66, 1], [67, 2],
      [74, 1.5], [72, 0.5], [71, 1], [69, 1], [67, 1], [69, 1], [71, 1], [67, 1], [69, 0.5], [71, 0.5], [72, 0.5], [69, 0.5], [71, 1.5], [69, 0.5], [67, 1], [66, 1], [67, 2],
      [69, 1.5], [71, 0.5], [72, 1], [69, 1], [71, 1.5], [72, 0.5], [74, 1], [69, 1], [71, 0.5], [73, 0.5], [74, 1], [76, 0.5], [78, 0.5], [79, 1], [78, 1], [76, 1], [74, 2],
      [74, 1.5], [72, 0.5], [71, 1], [69, 1], [67, 1], [69, 1], [71, 1], [67, 1], [76, 0.5], [76, 0.5], [76, 0.5], [76, 0.5], [74, 1.5], [72, 0.5], [71, 1], [69, 1], [67, 2],
    ],
    chords: [
      ["Gmaj7", 4], ["Gmaj7", 2], ["Em7", 2], ["Am7", 2], ["D7", 2], ["G6", 4],
      ["Gmaj7", 4], ["Gmaj7", 2], ["Em7", 2], ["Am7", 2], ["D7", 2], ["G6", 4],
      ["Am7", 2], ["D7", 2], ["Gmaj7", 2], ["D", 2], ["Em7", 1], ["A7", 1], ["Dmaj7", 2], ["Em7", 1], ["A7", 1], ["D7", 2],
      ["Gmaj7", 4], ["Gmaj7", 2], ["Em7", 2], ["Cmaj7", 2], ["D7", 2], ["G6", 4],
    ],
  },
  {
    id: "we-wish-you", name: "We Wish You a Merry Christmas", group: "christmas", meta: "Waltz · G", floor: 3, bpm: 132, beatsPerBar: 3, style: "waltz", transpose: 12,
    melody: [
      [null, 2], [62, 1],
      [67, 1], [67, 0.5], [69, 0.5], [67, 0.5], [66, 0.5], [64, 1], [64, 1], [64, 1],
      [69, 1], [69, 0.5], [71, 0.5], [69, 0.5], [67, 0.5], [66, 1], [62, 1], [62, 1],
      [71, 1], [71, 0.5], [72, 0.5], [71, 0.5], [69, 0.5], [67, 1], [64, 1], [62, 0.5], [62, 0.5],
      [64, 1], [69, 1], [66, 1], [67, 3],
    ],
    chords: [["G6", 3], ["Gmaj7", 3], ["Cmaj7", 3], ["A7", 3], ["D7", 3], ["B7", 3], ["Em7", 3], ["C", 1], ["D7", 2], ["G6", 3]],
  },
  {
    id: "silent-night", name: "Silent Night", group: "christmas", meta: "Slow waltz · G", floor: 4, bpm: 84, beatsPerBar: 3, style: "waltz", transpose: -12,
    melody: [
      [74, 1.5], [76, 0.5], [74, 1], [71, 3], [74, 1.5], [76, 0.5], [74, 1], [71, 3],
      [81, 2], [81, 1], [78, 3], [79, 2], [79, 1], [74, 3],
      [76, 2], [76, 1], [79, 1.5], [78, 0.5], [76, 1], [74, 1.5], [76, 0.5], [74, 1], [71, 3],
      [76, 2], [76, 1], [79, 1.5], [78, 0.5], [76, 1], [74, 1.5], [76, 0.5], [74, 1], [71, 3],
      [81, 2], [81, 1], [84, 1.5], [81, 0.5], [78, 1], [79, 3], [83, 3],
      [79, 1.5], [74, 0.5], [71, 1], [74, 1.5], [72, 0.5], [69, 1], [67, 3], [null, 3],
    ],
    chords: [
      ["Gmaj7", 12], ["Am7", 3], ["D7", 3], ["Gmaj7", 6], ["Cmaj7", 6], ["Gmaj7", 6], ["Cmaj7", 6], ["Gmaj7", 6],
      ["Am7", 3], ["D7", 3], ["Gmaj7", 3], ["Em7", 3], ["Gmaj7", 3], ["D7", 3], ["G6", 3], ["G6", 3],
    ],
  },
  {
    id: "ode-to-joy", name: "Ode to Joy", group: "all-year", meta: "Bossa · D", floor: 5, bpm: 108, beatsPerBar: 4, style: "bossa", transpose: 12,
    melody: [
      [66, 1], [66, 1], [67, 1], [69, 1], [69, 1], [67, 1], [66, 1], [64, 1], [62, 1], [62, 1], [64, 1], [66, 1], [66, 1.5], [64, 0.5], [64, 2],
      [66, 1], [66, 1], [67, 1], [69, 1], [69, 1], [67, 1], [66, 1], [64, 1], [62, 1], [62, 1], [64, 1], [66, 1], [64, 1.5], [62, 0.5], [62, 2],
      [64, 1], [64, 1], [66, 1], [62, 1], [64, 1], [66, 0.5], [67, 0.5], [66, 1], [62, 1], [64, 1], [66, 0.5], [67, 0.5], [66, 1], [64, 1], [62, 1], [64, 1], [57, 2],
      [66, 1], [66, 1], [67, 1], [69, 1], [69, 1], [67, 1], [66, 1], [64, 1], [62, 1], [62, 1], [64, 1], [66, 1], [64, 1.5], [62, 0.5], [62, 2],
    ],
    chords: [
      ["Dmaj7", 4], ["A7", 4], ["Dmaj7", 4], ["Em7", 2], ["A7", 2],
      ["Dmaj7", 4], ["A7", 4], ["Dmaj7", 4], ["A7", 2], ["D6", 2],
      ["A7", 2], ["Dmaj7", 2], ["A7", 2], ["Bm7", 2], ["Em7", 2], ["A7", 2], ["D", 2], ["A7", 2],
      ["Dmaj7", 4], ["A7", 4], ["Dmaj7", 4], ["A7", 2], ["D6", 2],
    ],
  },
  {
    // Counted in quavers: a bar of 3/8 is three beats.
    id: "fur-elise", name: "Für Elise", group: "all-year", meta: "Slow waltz · Am", floor: 6, bpm: 120, beatsPerBar: 3, style: "waltz", transpose: 0,
    melody: [
      [null, 2], [76, 0.5], [75, 0.5],
      [76, 0.5], [75, 0.5], [76, 0.5], [71, 0.5], [74, 0.5], [72, 0.5], [69, 1], [null, 0.5], [60, 0.5], [64, 0.5], [69, 0.5],
      [71, 1], [null, 0.5], [64, 0.5], [68, 0.5], [71, 0.5], [72, 1], [null, 0.5], [64, 0.5], [76, 0.5], [75, 0.5],
      [76, 0.5], [75, 0.5], [76, 0.5], [71, 0.5], [74, 0.5], [72, 0.5], [69, 1], [null, 0.5], [60, 0.5], [64, 0.5], [69, 0.5],
      [71, 1], [null, 0.5], [64, 0.5], [72, 0.5], [71, 0.5], [69, 3],
    ],
    chords: [["Am7", 3], ["E7", 3], ["Am7", 3], ["E7", 3], ["Am7", 3], ["E7", 3], ["Am7", 3], ["E7", 3], ["Am7", 3]],
  },
  {
    id: "gymnopedie", name: "Gymnopédie No. 1", group: "all-year", meta: "Slow waltz · D", floor: 7, bpm: 72, beatsPerBar: 3, style: "waltz", transpose: 0,
    melody: [
      [null, 12],
      [null, 1], [78, 1], [81, 1], [79, 1], [78, 1], [73, 1], [71, 1], [73, 1], [74, 1], [69, 3], [66, 6], [null, 6],
      [null, 1], [78, 1], [81, 1], [79, 1], [78, 1], [73, 1], [71, 1], [73, 1], [74, 1], [69, 3], [73, 3], [78, 3], [76, 6],
    ],
    chords: Array.from({ length: 20 }, (_, bar): [string, number] => [bar % 2 ? "Dmaj7" : "Gmaj7", 3]),
  },
]

/** The carol to play after this one: the next in its own group, wrapping round. */
export function nextCarolIndex(index: number): number {
  const group = CAROLS[index].group
  for (let step = 1; step <= CAROLS.length; step++) {
    const next = (index + step) % CAROLS.length
    if (CAROLS[next].group === group) return next
  }
  return index
}

export type ParsedChord = { tones: number[]; bassRoot: number; fifth: number }

const PITCH_CLASS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
}
const QUALITY: Record<string, number[]> = {
  "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9],
}
const mod12 = (n: number) => ((n % 12) + 12) % 12

export function parseChord(name: string): ParsedChord {
  const match = /^([A-G][#b]?)(.*)$/.exec(name)
  const root = match ? PITCH_CLASS[match[1]] : undefined
  const intervals = match ? QUALITY[match[2]] : undefined
  if (root === undefined || !intervals) throw new Error(`Unknown chord ${name}`)
  // A rootless voicing in one octave (F#3..F4) keeps the piano smooth without voice leading.
  const tones = (intervals.length > 3 ? intervals.slice(1) : intervals)
    .map((i) => 54 + mod12(root + i - 54))
    .sort((a, b) => a - b)
  const bassRoot = 40 + mod12(root - 4)
  const fifth = bassRoot + 7 > 52 ? bassRoot - 5 : bassRoot + 7
  return { tones, bassRoot, fifth }
}

export type CarolEvent =
  | { beat: number; kind: "melody" | "bass"; note: number; beats: number }
  | { beat: number; kind: "piano"; chord: ParsedChord; beats: number; velocity: number }
  | { beat: number; kind: "shaker" | "sleigh"; velocity: number }
  | { beat: number; kind: "brush" | "rim" }

export type ArrangedCarol = { events: CarolEvent[]; totalBeats: number }

/** Arranges a carol into timed events: the melody on vibraphone, with piano, bass and percussion in its style. */
export function arrangeCarol(carol: Carol): ArrangedCarol {
  const events: CarolEvent[] = []
  let beat = 0
  for (const [note, beats] of carol.melody) {
    if (note !== null) events.push({ beat, kind: "melody", note: note + carol.transpose, beats })
    beat += beats
  }
  const totalBeats = beat

  const segments: Array<{ start: number; end: number; chord: ParsedChord }> = []
  let start = 0
  for (const [name, beats] of carol.chords) {
    segments.push({ start, end: start + beats, chord: parseChord(name) })
    start += beats
  }
  if (start !== totalBeats) throw new Error(`${carol.name}: melody is ${totalBeats} beats, chords ${start}`)
  const chordAt = (at: number) => (segments.find((s) => at >= s.start && at < s.end) ?? segments[segments.length - 1]).chord

  const bars = Math.round(totalBeats / carol.beatsPerBar)
  for (let bar = 0; bar < bars; bar++) {
    const s = bar * carol.beatsPerBar
    if (carol.style === "bossa") {
      const comp: Array<[number, number]> = bar % 2 === 0 ? [[0, 1.4], [1.5, 1.4], [3, 0.9]] : [[0.5, 1.4], [2, 1.4], [3.5, 0.5]]
      for (const [o, beats] of comp) events.push({ beat: s + o, kind: "piano", chord: chordAt(s + o), beats, velocity: 1 })
      const bassLine: Array<[number, "root" | "fifth", number]> = [[0, "root", 1.4], [1.5, "fifth", 0.45], [2, "fifth", 1.4], [3.5, "root", 0.45]]
      for (const [o, which, beats] of bassLine) {
        const chord = chordAt(s + o)
        events.push({ beat: s + o, kind: "bass", note: which === "root" ? chord.bassRoot : chord.fifth, beats })
      }
      for (let e = 0; e < 8; e++) {
        events.push({ beat: s + e / 2, kind: "shaker", velocity: e % 2 ? 1 : 0.55 })
        events.push({ beat: s + e / 2, kind: "sleigh", velocity: e % 2 ? 0.55 : 1 })
      }
      for (const o of bar % 2 === 0 ? [0, 1.5, 3] : [1, 2.5]) events.push({ beat: s + o, kind: "rim" })
    } else {
      const chord = chordAt(s)
      events.push({ beat: s, kind: "bass", note: bar % 2 ? chord.fifth : chord.bassRoot, beats: 2.4 })
      events.push({ beat: s + 1, kind: "piano", chord: chordAt(s + 1), beats: 0.8, velocity: 0.8 })
      events.push({ beat: s + 2, kind: "piano", chord: chordAt(s + 2), beats: 0.8, velocity: 0.7 })
      events.push({ beat: s, kind: "brush" })
      events.push({ beat: s + 1, kind: "shaker", velocity: 0.6 }, { beat: s + 2, kind: "shaker", velocity: 0.6 })
      for (let e = 0; e < 3; e++) events.push({ beat: s + e, kind: "sleigh", velocity: e ? 0.6 : 1 })
    }
  }
  events.sort((a, b) => a.beat - b.beat)
  return { events, totalBeats }
}
