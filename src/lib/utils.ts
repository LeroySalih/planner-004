import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength).trimEnd()}…`
}

export function createWildcardRegExp(input: string): RegExp | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const placeholder = "__WILDCARD__"

  const sanitized = trimmed.replace(/\?/g, placeholder)
  const escaped = sanitized.replace(/[.*+^${}()|[\]\\]/g, "\\$&")
  const pattern = escaped.replace(new RegExp(placeholder, "g"), ".")

  try {
    return new RegExp(pattern, "i")
  } catch (error) {
    console.error("[v0] Failed to create wildcard regex:", error)
    return null
  }
}
