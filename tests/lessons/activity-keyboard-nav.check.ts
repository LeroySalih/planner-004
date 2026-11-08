import {
  isTextInputType,
  readingIndex,
  shouldMove,
  stickyOffset,
  targetIndex,
  type FocusKind,
} from '@/components/lessons/activity-keyboard-nav'

// When the arrow keys move between activities on a pupil lesson
// (src/components/lessons/activity-keyboard-nav.tsx). Pure: no DOM.
// Run: npx tsx tests/lessons/activity-keyboard-nav.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, isComposing: false }
const other: FocusKind = { kind: 'other' }
const input: FocusKind = { kind: 'text-input' }
const textarea = (start: number, end: number, length: number): FocusKind => ({
  kind: 'textarea',
  selectionStart: start,
  selectionEnd: end,
  length,
})

check('ArrowDown outside any field moves next', shouldMove('ArrowDown', other, plain) === 'next')
check('ArrowUp outside any field moves previous', shouldMove('ArrowUp', other, plain) === 'previous')
check('other keys are left alone', shouldMove('ArrowLeft', other, plain) === null && shouldMove('Enter', other, plain) === null)
for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
  check(`${modifier} held leaves the key alone`, shouldMove('ArrowDown', other, { ...plain, [modifier]: true }) === null)
}
check('an already handled key is left alone', shouldMove('ArrowDown', other, { ...plain, defaultPrevented: true }) === null)
check('a key during composition is left alone', shouldMove('ArrowDown', other, { ...plain, isComposing: true }) === null)
check('a single-line text box always moves', shouldMove('ArrowDown', input, plain) === 'next' && shouldMove('ArrowUp', input, plain) === 'previous')
check('a blocked control keeps its arrows', shouldMove('ArrowDown', { kind: 'blocked' }, plain) === null)

check('textarea: ArrowDown with the caret at the end moves', shouldMove('ArrowDown', textarea(5, 5, 5), plain) === 'next')
check('textarea: ArrowDown with the caret mid-text stays', shouldMove('ArrowDown', textarea(2, 2, 5), plain) === null)
check('textarea: ArrowDown with a selection stays', shouldMove('ArrowDown', textarea(0, 5, 5), plain) === null)
check('textarea: ArrowUp with the caret at the start moves', shouldMove('ArrowUp', textarea(0, 0, 5), plain) === 'previous')
check('textarea: ArrowUp with the caret at the end stays', shouldMove('ArrowUp', textarea(5, 5, 5), plain) === null)
check('textarea: an empty box moves both ways', shouldMove('ArrowUp', textarea(0, 0, 0), plain) === 'previous' && shouldMove('ArrowDown', textarea(0, 0, 0), plain) === 'next')

check('a missing type is text', isTextInputType(null) && isTextInputType(''))
check('text-like types are text', ['text', 'search', 'email', 'url', 'tel', 'TEXT'].every(isTextInputType))
check(
  'number and the other input types are not text',
  !['number', 'radio', 'checkbox', 'range', 'date', 'file', 'password', 'submit'].some(isTextInputType),
)

check('above the first activity nothing is being read', readingIndex([300, 900, 1500], 100) === -1)
check('the last activity whose top has passed the line is being read', readingIndex([-800, -100, 400], 100) === 1)
check('an activity just placed at the line is being read', readingIndex([-700, 100, 700], 100) === 1)
check('an activity within the tolerance counts as reached', readingIndex([-700, 106, 700], 100) === 1)

check('from before the first, ArrowDown goes to the first', targetIndex(-1, 3, 'next') === 0)
check('from before the first, ArrowUp does nothing', targetIndex(-1, 3, 'previous') === null)
check('ArrowDown goes to the next', targetIndex(0, 3, 'next') === 1)
check('ArrowUp goes to the previous', targetIndex(2, 3, 'previous') === 1)
check('at the last, ArrowDown does nothing', targetIndex(2, 3, 'next') === null)
check('at the first, ArrowUp does nothing', targetIndex(0, 3, 'previous') === null)
check('with no activities, nothing moves', targetIndex(-1, 0, 'next') === null)

check('no pinned headers, no offset', stickyOffset([]) === 0)
check(
  'the offset clears the lowest pinned header',
  stickyOffset([{ top: 0, height: 80 }, { top: 80, height: 72 }]) === 152,
  String(stickyOffset([{ top: 0, height: 80 }, { top: 80, height: 72 }])),
)

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
