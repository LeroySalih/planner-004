import Module from 'node:module'
import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import type { SetLessonViewModeResult } from '@/lib/server-actions/profile'

// The lesson layout preference (migration 138) and setLessonViewModeAction,
// against a dev database. The action runs outside Next, so its session guard
// and revalidatePath are stubbed: the signed-in user is a throwaway profile
// this check creates and deletes again.
// Run with DATABASE_URL set: npx tsx tests/profile/lesson-view-mode.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const SIGNED_IN = `lvm-check-${randomUUID()}`
const OTHER = `lvm-check-${randomUUID()}`
const revalidated: string[] = []

function stub(specifier: string, exports: Record<string, unknown>) {
  const path = require.resolve(specifier)
  const module = new Module(path)
  module.exports = exports
  module.loaded = true
  require.cache[path] = module
}

const modeOf = async (userId: string) =>
  (await query<{ lesson_view_mode: string }>('select lesson_view_mode from profiles where user_id = $1', [userId])).rows[0]
    ?.lesson_view_mode

async function main() {
  stub('@/lib/auth', {
    requireAuthenticatedProfile: async () => ({ userId: SIGNED_IN, roles: ['pupil'], isTeacher: false }),
    requireTeacherProfile: async () => {
      throw new Error('not used')
    },
    hashPassword: async () => {
      throw new Error('not used')
    },
  })
  stub('next/cache', { revalidatePath: (path: string) => revalidated.push(path) })
  const { setLessonViewModeAction } = require('@/lib/server-actions/profile') as {
    setLessonViewModeAction: (mode: unknown) => Promise<SetLessonViewModeResult>
  }

  await query('insert into profiles (user_id, first_name, last_name) values ($1, $3, $3), ($2, $3, $3)', [
    SIGNED_IN,
    OTHER,
    'Layout check',
  ])
  try {
    check('a new profile shows lessons as a page', (await modeOf(SIGNED_IN)) === 'page')

    try {
      await query(`update profiles set lesson_view_mode = 'carousel' where user_id = $1`, [SIGNED_IN])
      check('the column refuses an unknown layout', false, 'was accepted')
    } catch {
      check('the column refuses an unknown layout', true)
    }

    const slides = await setLessonViewModeAction('slides')
    check('choosing slides saves it', slides.error === null && slides.data?.lessonViewMode === 'slides')
    check('the choice is stored on the signed-in profile', (await modeOf(SIGNED_IN)) === 'slides')
    check('nobody else changes', (await modeOf(OTHER)) === 'page')
    check(
      'the lesson page is revalidated',
      revalidated.includes('/pupil-lessons/[pupilId]/lessons/[lessonId]'),
      revalidated.join(', '),
    )

    const bad = await setLessonViewModeAction('carousel')
    check('an unknown layout is refused', bad.data === null && Boolean(bad.error))
    check('a refused layout changes nothing', (await modeOf(SIGNED_IN)) === 'slides')

    const page = await setLessonViewModeAction('page')
    check('choosing page switches back', page.error === null && (await modeOf(SIGNED_IN)) === 'page')
  } finally {
    await query('delete from profiles where user_id = any($1::text[])', [[SIGNED_IN, OTHER]])
  }

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  query('delete from profiles where user_id = any($1::text[])', [[SIGNED_IN, OTHER]]).finally(() => process.exit(1))
})
