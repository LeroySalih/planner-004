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

export function normalizeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
      .toISOString()
      .slice(0, 10)
  }

  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (directMatch) {
    return directMatch[1]
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString().slice(0, 10)
}

function parseDateOnlyToUtc(value: string | Date | null | undefined): Date | null {
  const normalized = normalizeDateOnly(value)
  if (!normalized) {
    return null
  }

  const [year, month, day] = normalized.split("-").map(Number)
  if (![year, month, day].every((part) => Number.isFinite(part))) {
    return null
  }

  return new Date(Date.UTC(year, month - 1, day))
}

export function normalizeAssignmentWeek(
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
): { start: string; end: string } | null {
  const startUtc = parseDateOnlyToUtc(startDate)
  if (!startUtc) {
    return null
  }

  const sunday = new Date(startUtc)
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay())

  const endUtc = parseDateOnlyToUtc(endDate) ?? sunday
  const saturday = new Date(endUtc)
  saturday.setUTCDate(saturday.getUTCDate() - saturday.getUTCDay() + 6)

  if (saturday.getTime() < sunday.getTime()) {
    saturday.setUTCDate(sunday.getUTCDate() + 6)
  }

  return {
    start: sunday.toISOString().slice(0, 10),
    end: saturday.toISOString().slice(0, 10),
  }
}
