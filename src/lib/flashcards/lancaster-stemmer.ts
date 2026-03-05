// Vendored Lancaster stemmer — no Node.js dependencies, safe for browser bundles.
// Algorithm: Chris Umbel (natural project, MIT licence)
// Rules data: lancaster-rules.js (copied from natural@8)

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ruleTable = require("./lancaster-rules").rules as Record<
  string,
  { continuation: boolean; intact: boolean; pattern: string; size: number; appendage?: string }[]
>

function acceptable(candidate: string): boolean {
  if (/^[aeiou]/.test(candidate)) return candidate.length > 1
  return candidate.length > 2 && /[aeiouy]/.test(candidate)
}

function applyRuleSection(token: string, intact: boolean): string {
  const section = token.slice(-1)
  const rules = ruleTable[section]

  if (rules) {
    for (const rule of rules) {
      if (
        (intact || !rule.intact) &&
        token.slice(-rule.pattern.length) === rule.pattern
      ) {
        let result = token.slice(0, token.length - rule.size)
        if (rule.appendage) result += rule.appendage

        if (acceptable(result)) {
          token = result
          if (rule.continuation) return applyRuleSection(result, false)
          return result
        }
      }
    }
  }

  return token
}

export function lancasterStem(word: string): string {
  return applyRuleSection(word.toLowerCase(), true)
}
