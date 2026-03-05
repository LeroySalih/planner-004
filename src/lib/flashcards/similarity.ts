import { lancasterStem } from "./lancaster-stemmer"

export const SIMILARITY_THRESHOLD = 0.85

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

export function similarity(a: string, b: string): number {
  const normA = a.trim().toLowerCase()
  const normB = b.trim().toLowerCase()
  if (normA === normB) return 1

  // Stem match via Lancaster stemmer (handles malleable/malleability, corrosion/corrosive, etc.)
  const stemA = lancasterStem(normA)
  const stemB = lancasterStem(normB)
  if (stemA === stemB && stemA.length >= 3) return 0.9

  const maxLen = Math.max(normA.length, normB.length)
  if (maxLen === 0) return 1
  const distance = levenshteinDistance(normA, normB)
  return 1 - distance / maxLen
}
