import { findTextCorruption, type GuardMode } from '@/lib/ai/model-output-guard'

// The model output guard on strings alone, no database or model. Damage seen
// in real marking replies must be caught, in the mode its field is checked in
// (strict for pupil comments, note for a marker's teacher-only note), and the
// near misses that healthy text contains must pass.
// Run: npx tsx tests/ai/model-output-guard.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

function caught(text: string, kind: string, mode: GuardMode = 'strict', quotesCode = false) {
  const found = findTextCorruption(text, { mode, quotesCode })
  check(`${mode}${quotesCode ? '+code' : ''} rejects (${kind}): ${JSON.stringify(text.slice(-60))}`, found?.kind === kind, JSON.stringify(found))
}

function passes(text: string, mode: GuardMode = 'strict', quotesCode = false) {
  const found = findTextCorruption(text, { mode, quotesCode })
  check(`${mode}${quotesCode ? '+code' : ''} accepts: ${JSON.stringify(text.slice(-70))}`, found === null, JSON.stringify(found))
}

// Damage from real replies (Sonnet 5, November 2026), exactly as stored.
caught(
  'Select the first animation in the Animation Pane and change its start setting from On Click to After Previous so all three exhibit names play one after another automatically.4',
  'trailing-digit',
)
caught("Insert a hyperlink on the text so the link is recorded in the presentation.'", 'unmatched-quote')
caught(
  'Mark scheme requires short bullet points drawn from PEARL TEXT on both slides 3 and 4; neither slide meets this, so 0 marks awarded.</br>',
  'html-tag',
  'note',
)
caught('You correctly used \'and\' to combine old_enough and the permission check in your can_go line, so this criterion is met.0', 'trailing-digit', 'strict', true)
caught('Correct "', 'unmatched-quote')
caught('Correct ""Oil is indeed the raw material used to make synthetic fibres like polyester and acrylic."', 'unmatched-quote')
caught('This is what the question is asking for.”', 'unmatched-quote')
caught('You checked the range first and printed "Invalid percentage" in that branch, which meets the requirement.\'', 'unmatched-quote', 'strict', true)
// Mid-text and other tags.
caught('The transition is set automatically.4 Next time set it to 5 seconds.', 'trailing-digit')
caught('Your title is bold.<br>Make the body text larger.', 'html-tag')
caught('Your title is bold.<br/>', 'html-tag')
caught('Your title is bold <br />', 'html-tag')
caught('Slide 2 has no picture placeholder.<br>Slide 3 has one.', 'html-tag', 'note')
caught('Slide 2 uses <b>bold</b> text.', 'html-tag', 'note')
caught('The footer is centred, so the mark is awarded.4', 'trailing-digit', 'note')
// A tag outside the quoted code in code feedback is still caught.
caught('You used `<br>` correctly.</br>', 'html-tag', 'strict', true)

// Healthy near misses.
passes('Your slides say Version 2.4 of the brochure.')
passes('The picture on slide 4.')
passes('The picture is 10 cm x 7.5 cm, so it fits the placeholder.')
passes("It's centred, but the date isn't automatic.")
passes('Click the "Home" button on slide 1 to return.')
passes('Your title reads "Welcome to the Aquarium."')
passes("Your title reads 'Welcome to the Aquarium.'")
passes("Your title reads ‘Welcome to the Aquarium.’")
passes('Your title reads “Welcome to the Aquarium.”')
passes("You did not label the pupils' work.")
passes("Check the class teachers'")
passes('Your score is 3/4.')
passes('You scored 4 out of 5.')
passes('Section 6.2 asks for a footer on every slide.')
passes('Use 24 pt or more, since a size < 18 pt is hard to read at a kiosk.')
passes('Use a ratio of 16:9 rather than 4:3.')
passes('Replace the <your name> text on slide 1 with a title.')
passes('Your code checks p < 0 or p > 100 first.', 'strict', true)
passes('Your print("<br>") line adds a break.', 'strict', true)
passes('You used `<br>` between the lines, which works.', 'strict', true)
passes('Overall the work is excellent!')
passes('')
passes('The note quotes slide 1: "Welcome to Pearl Coast Aquarium.\nOpening times', 'note')
passes("Slide 1 title 'Welcome to Pearl Coast Aquarium' is 45 pt, so the mark is awarded.", 'note')
passes('Picture 7 at (17.22, 0.00) cm, 8.18 x 3.07 cm; transparency 60%.', 'note')
passes('Slide 3 animations: Turtle Cove On Click.\n\nSlide 4: none.', 'note')

// lenient is unchanged: chat and transcriptions may carry HTML and "P.78" honestly.
passes('Add a <br> tag after each line of the address.', 'lenient')
passes("'P.78 GiB X' next to C", 'lenient')
passes('Version 2.4', 'note')

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
