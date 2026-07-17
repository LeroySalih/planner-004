// Scoring for the "sequence" activity: the pupil reorders terms and the score is
// the length of the longest correctly-ordered run divided by the number of terms.
//
// "Longest correctly-ordered run" = the longest subsequence of the pupil's
// arrangement whose terms appear in the same relative order as the correct
// sequence — i.e. a Longest Increasing Subsequence over each term's correct
// rank. This rewards relative ordering and is forgiving of a single misplaced
// item (e.g. correct A,B,C,D vs pupil B,C,D,A scores 3/4, keeping B,C,D).
//
// Returns the 0-1 fraction and the ids of the terms that make up that run, which
// the UI highlights as "correct" once feedback is released.
export function scoreSequence(
  correctOrder: string[],
  pupilOrder: string[],
): { score: number; correctIds: string[] } {
  const total = correctOrder.length
  if (total === 0) return { score: 0, correctIds: [] }

  const rankById = new Map<string, number>()
  correctOrder.forEach((id, index) => rankById.set(id, index))

  // Pupil arrangement mapped to correct ranks (ignoring any unknown ids).
  const seq: { id: string; rank: number }[] = []
  for (const id of pupilOrder) {
    const rank = rankById.get(id)
    if (rank !== undefined) seq.push({ id, rank })
  }

  const n = seq.length
  if (n === 0) return { score: 0, correctIds: [] }

  // Longest strictly-increasing subsequence over rank (patience sorting) with
  // predecessor tracking so we can reconstruct which ids form the run.
  const tailIndex: number[] = [] // tailIndex[k] = seq index ending an increasing run of length k+1
  const tailRank: number[] = []
  const prev: number[] = new Array(n).fill(-1)

  for (let i = 0; i < n; i++) {
    const rank = seq[i].rank
    let lo = 0
    let hi = tailRank.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tailRank[mid] < rank) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tailIndex[lo - 1]
    tailIndex[lo] = i
    tailRank[lo] = rank
  }

  const runLength = tailIndex.length
  const correctIds: string[] = []
  let cursor = tailIndex[runLength - 1]
  while (cursor !== -1) {
    correctIds.push(seq[cursor].id)
    cursor = prev[cursor]
  }
  correctIds.reverse()

  return { score: runLength / total, correctIds }
}
