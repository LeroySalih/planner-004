export function createWildcardRegex(pattern: string) {
  const escaped = Array.from(pattern)
    .map((char) => {
      if (char === "?") return "."
      return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
    .join("")

  return new RegExp(escaped, "i")
}
