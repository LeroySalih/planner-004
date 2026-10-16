import "server-only"

import { timingSafeEqual } from "node:crypto"

/**
 * The password a teacher's reset gives an account. Anyone signed in with it
 * must choose their own before using DINO (profiles.must_change_password).
 */
export const DEFAULT_PUPIL_PASSWORD = "bisak123"

export function isDefaultPassword(password: string): boolean {
  const given = Buffer.from(password)
  const expected = Buffer.from(DEFAULT_PUPIL_PASSWORD)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
