# Pupil Lesson Launch Buttons Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Launch Lesson and Launch Revision buttons with score display to each lesson card in the pupil lessons list view.

**Architecture:** Modify the `PupilUnitsView` client component to remove the compact revision button from the top-right and add a new button section at the bottom of each lesson card. The section includes two action buttons (Launch Lesson always visible, Launch Revision conditionally visible) and score displays beneath.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, shadcn/ui components

---

## Task 1: Remove Existing Compact Revision Button

**Files:**
- Modify: `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx:229-243`

**Step 1: Locate and remove the compact revision button**

Find line 242 containing `<StartRevisionButton lessonId={lesson.lessonId} compact />` and the surrounding div that contains it (lines 229-243).

Remove the entire revision button section:

```tsx
// DELETE THIS ENTIRE BLOCK (lines 229-243):
                                      {/* Revision Score & Launch */}
                                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                        {lesson.revisionScore !== null && lesson.revisionMaxScore !== null && lesson.revisionMaxScore > 0 && (
                                          <>
                                            {lesson.revisionDate && (
                                                <span className="text-[10px] text-muted-foreground">
                                                    Rev: {formatDate(lesson.revisionDate)}
                                                </span>
                                            )}
                                            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${getRevisionBadgeColor(lesson.revisionDate)}`}>
                                                Revision: {Math.round(lesson.revisionScore * 10) / 10}/{lesson.revisionMaxScore} ({Math.round((lesson.revisionScore / lesson.revisionMaxScore) * 100)}%)
                                            </span>
                                          </>
                                        )}
                                        <StartRevisionButton lessonId={lesson.lessonId} compact />
                                      </div>
```

**Step 2: Verify the file compiles**

Run: `npm run build 2>&1 | grep -A5 -B5 "pupil-units-view" || echo "Build successful"`
Expected: No TypeScript errors in pupil-units-view.tsx

**Step 3: Commit the removal**

```bash
git add src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx
git commit -m "Remove compact revision button from lesson cards

Removes the top-right revision button and score display in preparation
for adding full-featured buttons at the bottom of each lesson card.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Launch Lesson and Launch Revision Buttons

**Files:**
- Modify: `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx:247-254`

**Step 1: Import required components**

At the top of the file, verify these imports exist (they should already be there):
- `Link` from `next/link` - line 4
- `StartRevisionButton` - line 12
- `Button` - needs to be added

Add Button import after line 10:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { PupilUnitsDetail, PupilUnitLesson } from "@/lib/pupil-units-data"
```

Also import the BookOpen icon from lucide-react at line 8:

```tsx
import { ChevronDown, BookOpen } from "lucide-react"
```

**Step 2: Add button section after LessonMedia**

After the `<LessonMedia>` component (currently around line 253), add the new button section. Find this line:

```tsx
                                  <div className="mt-3 space-y-3">
                                    <LessonMedia
                                      lessonId={lesson.lessonId}
                                      lessonTitle={lesson.lessonTitle}
                                      images={lesson.displayImages}
                                      files={lesson.files}
                                    />
                                  </div>
```

Add immediately after the closing `</div>`:

```tsx
                                  <div className="mt-3 space-y-3">
                                    <LessonMedia
                                      lessonId={lesson.lessonId}
                                      lessonTitle={lesson.lessonTitle}
                                      images={lesson.displayImages}
                                      files={lesson.files}
                                    />
                                  </div>

                                  {/* Launch Buttons */}
                                  {lesson.isEnrolled && (
                                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-2">
                                      <Button asChild className="gap-2">
                                        <Link
                                          href={`/pupil-lessons/${encodeURIComponent(detail.pupilId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
                                        >
                                          <BookOpen className="h-4 w-4" />
                                          Launch Lesson
                                        </Link>
                                      </Button>

                                      {lesson.lessonScore !== null && (
                                        <StartRevisionButton lessonId={lesson.lessonId} />
                                      )}
                                    </div>
                                  )}
```

**Step 3: Verify the file compiles**

Run: `npm run build 2>&1 | grep -A5 -B5 "pupil-units-view" || echo "Build successful"`
Expected: No TypeScript errors

**Step 4: Commit the button addition**

```bash
git add src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx
git commit -m "Add Launch Lesson and Launch Revision buttons to lesson cards

- Launch Lesson button always visible for enrolled lessons
- Launch Revision button conditionally visible when lessonScore exists
- Buttons are responsive (stack on mobile, horizontal on desktop)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Score Display Section

**Files:**
- Modify: `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx` (after button section)

**Step 1: Add score display after buttons**

Immediately after the button section you just added, add the score display. The complete button and score section should look like this:

```tsx
                                  {/* Launch Buttons */}
                                  {lesson.isEnrolled && (
                                    <div className="mt-4 space-y-3">
                                      <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
                                        <Button asChild className="gap-2">
                                          <Link
                                            href={`/pupil-lessons/${encodeURIComponent(detail.pupilId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
                                          >
                                            <BookOpen className="h-4 w-4" />
                                            Launch Lesson
                                          </Link>
                                        </Button>

                                        {lesson.lessonScore !== null && (
                                          <StartRevisionButton lessonId={lesson.lessonId} />
                                        )}
                                      </div>

                                      {/* Score Display */}
                                      <div className="flex flex-col gap-1.5 text-sm">
                                        {lesson.lessonScore !== null && lesson.lessonMaxScore !== null && lesson.lessonMaxScore > 0 && (
                                          <div className="flex items-center gap-2">
                                            <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                              Lesson Score: {Math.round(lesson.lessonScore * 10) / 10}/{lesson.lessonMaxScore} ({Math.round((lesson.lessonScore / lesson.lessonMaxScore) * 100)}%)
                                            </span>
                                          </div>
                                        )}

                                        {lesson.revisionScore !== null && lesson.revisionMaxScore !== null && lesson.revisionMaxScore > 0 && (
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${getRevisionBadgeColor(lesson.revisionDate)}`}>
                                              Revision: {Math.round(lesson.revisionScore * 10) / 10}/{lesson.revisionMaxScore} ({Math.round((lesson.revisionScore / lesson.revisionMaxScore) * 100)}%)
                                            </span>
                                            {lesson.revisionDate && (
                                              <span className="text-xs text-muted-foreground">
                                                Last revised: {formatDate(lesson.revisionDate)}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
```

**Step 2: Verify the file compiles**

Run: `npm run build 2>&1 | grep -A5 -B5 "pupil-units-view" || echo "Build successful"`
Expected: No TypeScript errors

**Step 3: Commit the score display**

```bash
git add src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx
git commit -m "Add score display beneath launch buttons

Shows lesson and revision scores with color-coded badges indicating
recency of revision activity. Scores only display when available.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Manual Testing

**Files:**
- None (manual verification)

**Step 1: Start the development server**

Run: `npm run dev`
Expected: Server starts on http://localhost:3000

**Step 2: Navigate to pupil lessons page**

1. Open browser to http://localhost:3000
2. Sign in if needed
3. Navigate to `/pupil-lessons/[pupilId]` (use a valid pupil ID from your system)

**Step 3: Verify button visibility**

Check for each lesson in the list:

**For lessons with NO submissions (lessonScore === null):**
- ✅ "Launch Lesson" button visible
- ✅ "Launch Revision" button NOT visible
- ✅ No score badges visible

**For lessons WITH submissions (lessonScore !== null):**
- ✅ "Launch Lesson" button visible
- ✅ "Launch Revision" button visible
- ✅ Lesson score badge visible beneath buttons
- ✅ Revision score badge visible (if revision completed)

**Step 4: Test button functionality**

1. Click "Launch Lesson" → should navigate to lesson detail page
2. Click "Launch Revision" → should start revision session
3. Test on mobile viewport (responsive stacking)

**Step 5: Visual verification**

Check that:
- Buttons are properly styled and aligned
- Scores use correct color coding (blue for lesson, green/amber/red for revision)
- Layout is responsive (stacks on mobile, horizontal on desktop)
- Spacing is consistent with rest of page

**Step 6: Document any issues**

If any issues found, create TODO comments in code or note for follow-up.

---

## Task 5: Final Commit and Cleanup

**Files:**
- All modified files

**Step 1: Review all changes**

Run: `git diff dev --stat`
Expected: Only `pupil-units-view.tsx` modified

Run: `git log --oneline -5`
Expected: See your 3 commits

**Step 2: Verify clean working directory**

Run: `git status`
Expected: "nothing to commit, working tree clean"

**Step 3: Push to remote (if applicable)**

```bash
git push origin feature/pupil-lesson-launch-buttons
```

**Step 4: Return to main worktree**

```bash
cd ../..
pwd  # Should show main project directory
```

---

## Summary

**Files Modified:**
- `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx`

**Changes:**
1. Removed compact revision button from top-right
2. Added Launch Lesson button (always visible for enrolled lessons)
3. Added Launch Revision button (conditional on lessonScore !== null)
4. Added score display section beneath buttons
5. Maintained responsive design (mobile/desktop)

**Testing:**
- Manual testing in browser required
- Verify button visibility logic
- Test navigation and revision launch
- Check responsive layout

**Next Steps:**
After completing implementation:
- Use @superpowers:finishing-a-development-branch to create PR or merge
- Manual QA in staging environment
- Update any related documentation if needed
