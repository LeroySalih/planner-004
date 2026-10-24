// A shuffle that comes out the same for the same seed. Pupil activities shuffle
// while rendering; with Math.random the server and the browser shuffled
// differently and React threw the server's HTML away. Seed with the activity
// and pupil so each pupil keeps one arrangement until their answer saves it.

export function seededRandom(seed: string): () => number {
  let state = 2166136261
  for (let i = 0; i < seed.length; i += 1) state = Math.imul(state ^ seed.charCodeAt(i), 16777619)
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507)
    state = Math.imul(state ^ (state >>> 13), 3266489909)
    return ((state ^= state >>> 16) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
