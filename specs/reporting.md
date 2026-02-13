# Unit Progress Reports - Technical Documentation

**Last Updated:** 2025-02-13
**Status:** Fixed and Enhanced

## Overview

This document details the unit progress reporting system, including a critical bug that was discovered and fixed, and subsequent enhancements made to improve reporting functionality.

---

## The Problem

### Initial Issue

The unit progress reports were displaying **34%** for a pupil (Khalifa Agnia) on the `/unit-progress-reports` pages, while the assignments page correctly showed **68%** for the same activity.

### Root Cause

The queries in `src/app/unit-progress-reports/actions.ts` were **averaging individual success criteria feedback records** instead of using **submission-level scores**.

**Example breakdown:**
- Activity: "Submit your work"
- Success Criteria: 14 criteria
  - 7 criteria scored at Full (100%)
  - 5 criteria scored at Partial (50%)
  - 2 criteria scored at None (0%)
- **Correct calculation:** (7×100 + 5×50 + 2×0) / 1400 = 950/1400 = **68%**

However, the database contained:
- **1 submission** with `teacher_override_score = 0.6786` (68%) ✓ Correct
- **12 pupil_activity_feedback records** (one per success criterion that was stored)
- These 12 records averaged to **0.339 (34%)** ✗ Incorrect

The queries were using `AVG(pupil_activity_feedback.score)` which averaged the 12 individual records, not the submission's final score.

---

## Database Schema

### Key Tables

**`submissions`**
- Stores submission-level data for each pupil's activity submission
- `body` JSON field contains `teacher_override_score` (decimal 0-1)
- This score represents the **final calculated or overridden score** for the entire submission
- One row per submission (one submission per activity per pupil typically)

**`pupil_activity_feedback`**
- Stores granular feedback per success criterion
- Links to a submission via `submission_id`
- `score` field contains the individual success criterion score (decimal 0-1)
- Multiple rows per submission (one per success criterion)

**`activities`**
- `is_summative` boolean flag indicates assessment activities
- Used for filtering when "summative only" toggle is enabled

### Relationship
```
submission (1) ──< pupil_activity_feedback (many)
     │
     └─ teacher_override_score = final score (68%)
            vs
     pupil_activity_feedback.score = individual criterion scores (avg 34%)
```

---

## The Fix

### Changed Queries

Modified all 5 server actions in `src/app/unit-progress-reports/actions.ts` to use submission-level scores:

**Before (Incorrect):**
```sql
LEFT JOIN pupil_activity_feedback paf
  ON paf.activity_id = a.activity_id
  AND paf.pupil_id = gm.user_id
AVG(CASE WHEN $N = true AND a.is_summative = false
    THEN NULL
    ELSE paf.score END) as avg_score
```

**After (Correct):**
```sql
LEFT JOIN submissions s
  ON s.activity_id = a.activity_id
  AND s.user_id = gm.user_id
AVG(CASE WHEN $N = true AND a.is_summative = false
    THEN NULL
    ELSE COALESCE((s.body->>'teacher_override_score')::numeric, 0) END) as avg_score
```

### Functions Updated

1. `getClassProgressAction` - Unit averages per class
2. `getProgressMatrixAction` - All units across all classes
3. `getClassPupilMatrixAction` - Unit scores per pupil in a class
4. `getUnitLessonMatrixAction` - Lesson scores per pupil in a unit
5. `getPupilUnitLessonsAction` - Lesson averages for a specific pupil

### Why This Works

The `teacher_override_score` field stores the **submission-level final score**, which can be:
1. **Auto-calculated** from success criteria (as in the 68% case)
2. **Manually overridden** by a teacher

In both cases, this is the authoritative score for the submission, not the average of individual feedback records.

---

## Summative Filter Implementation

### Purpose

Teachers can toggle between:
- **All activities** - includes both formative and summative activities
- **Summative only** - filters to show only assessment activities

### Implementation

**URL-based state:**
- Query parameter: `?summative=true`
- Managed via Next.js 15 `searchParams` (async Promise)

**SQL filtering:**
```sql
CASE WHEN $summativeOnly = true AND a.is_summative = false
  THEN NULL  -- Exclude formative activities when toggle is on
  ELSE score
END
```

**UI Component:**
- `<Switch>` component in each matrix page
- Updates URL params via `router.push()`
- Server components re-render with new data

### Pages with Toggle

1. `/unit-progress-reports` - Main overview
2. `/unit-progress-reports/[groupId]` - Class pupil matrix
3. `/unit-progress-reports/[groupId]/[unitId]` - Lesson matrix
4. `/unit-progress-reports/[groupId]/[unitId]/[pupilId]` - Individual pupil lessons

---

## Enhancement: Average and Level Columns

### Added to Lesson Matrix

The `/unit-progress-reports/[groupId]/[unitId]` page now includes two summary columns:

1. **Average Column**
   - Calculates average percentage across all lessons for each pupil
   - Formula: `SUM(lesson_scores) / COUNT(lessons_with_scores)`
   - Only includes lessons where pupil has a score (ignores nulls)
   - Uses same color coding as lesson cells:
     - Red: <40%
     - Amber: 40-69%
     - Green: ≥70%

2. **Level Column**
   - Calculates level based on average score and pupil's year group
   - Uses `getLevelForYearScore(year, avgScore)` from `src/lib/levels/index.ts`
   - Year group parsed from groupId (e.g., "25-7A-IT" → Year 7)
   - Displays level string (e.g., "3M", "4H", "5L")

### Implementation Details

**Year Group Parsing:**
```typescript
function parseYearFromGroupId(groupId: string): number | null {
  // Expected format: "25-7A-IT" where 7 is the year group
  const match = groupId.match(/^\d+-(\d+)[A-Z]?-/)
  if (match && match[1]) {
    const year = parseInt(match[1], 10)
    if (year >= 7 && year <= 11) {
      return year
    }
  }
  return null
}
```

**Average Calculation:**
```typescript
function calculatePupilAverage(
  pupilId: string,
  lessons: { pupilMetrics: Map<string, { avgScore: number | null }> }[]
): number | null {
  const scores: number[] = []

  for (const lesson of lessons) {
    const metrics = lesson.pupilMetrics.get(pupilId)
    if (metrics && typeof metrics.avgScore === 'number' && !Number.isNaN(metrics.avgScore)) {
      scores.push(metrics.avgScore)
    }
  }

  if (scores.length === 0) {
    return null
  }

  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}
```

### Visual Design

- Both columns have blue background (`bg-blue-50 dark:bg-blue-900/20`)
- Average column uses bold font with color coding
- Level column shows level string in bold
- Both columns clearly distinguished from lesson columns

---

## Success Criteria Scoring

### How Scores Are Calculated

Each activity can have multiple success criteria. For each criterion, teachers can award:
- **Full** = 100 points (1.0)
- **Partial** = 50 points (0.5)
- **None** = 0 points (0.0)

**Final submission score formula:**
```
score = SUM(criterion_points) / (COUNT(criteria) × 100)
```

**Example:** 14 criteria
- 7 at Full = 700 points
- 5 at Partial = 250 points
- 2 at None = 0 points
- Total: 950 / 1400 = 0.6786 = **68%**

This calculated score is stored in `submissions.body->>'teacher_override_score'`.

### Teacher Override

Teachers can manually override the calculated score:
1. System calculates score from success criteria
2. Teacher reviews and can adjust the final score
3. Adjusted score is stored in the same `teacher_override_score` field
4. The field name is misleading - it stores both calculated and overridden scores

---

## Level Calculation

Levels are calculated using year-specific thresholds defined in `src/lib/levels/index.ts`.

**Example thresholds for Year 7:**
- 1L: 6%
- 1M: 11%
- 1H: 17%
- 2L: 22%
- 2M: 33%
- 2H: 40%
- 3L: 47%
- 3M: 53%
- 3H: 60%
- 4L: 67%
- 4M: 73%
- ...up to 5M: 93%

**For 68% in Year 7:** Level = **4L** (threshold 67%, next is 4M at 73%)

See `specs/calc-levels.md` for complete threshold tables for all year groups.

---

## File Changes

### Modified Files

1. **`src/app/unit-progress-reports/actions.ts`**
   - Changed all 5 server actions to use `submissions` table
   - Replaced `pupil_activity_feedback` joins with `submissions` joins
   - Updated score calculation to use `teacher_override_score`

2. **`src/app/unit-progress-reports/[groupId]/[unitId]/page.tsx`**
   - Added `groupId` prop to `<LessonMatrix>`

3. **`src/app/unit-progress-reports/[groupId]/[unitId]/lesson-matrix.tsx`**
   - Added `groupId` prop
   - Imported `getLevelForYearScore` from `@/lib/levels`
   - Added `parseYearFromGroupId()` helper
   - Added `calculatePupilAverage()` helper
   - Added two new columns to table (Average and Level)
   - Updated component to calculate and display summary data

---

## Testing

### Verification Steps

1. **Navigate to:** `/unit-progress-reports/[groupId]/[unitId]?summative=true`
2. **Verify:** Scores match assignments page (68% not 34%)
3. **Toggle:** Switch between "all activities" and "summative only"
4. **Check:** Average column shows correct average across lessons
5. **Check:** Level column shows correct level based on year group
6. **Test:** Multiple year groups (7, 8, 9, 10, 11) for level calculation

### Known Limitations

1. **Year group parsing** assumes groupId format "XX-YA-Subject"
   - If format changes, parsing will fail
   - Returns null if year not in range 7-11
   - Consider storing year_group in database instead

2. **Multiple submissions per activity**
   - Current implementation averages all submission scores
   - Most activities have one submission per pupil
   - Edge case: if pupil resubmits, which score should be used?

3. **Missing data handling**
   - Shows "—" when no scores available
   - Average excludes lessons with null scores
   - Level calculation requires valid average

---

## Related Documentation

- **`specs/calc-levels.md`** - Complete level threshold tables
- **`CLAUDE.md`** - Project architecture and conventions
- **`src/lib/levels/index.ts`** - Level calculation implementation

---

## Future Improvements

1. **Store year_group in database**
   - Add `year_group` column to `groups` table
   - Remove dependency on groupId parsing
   - More reliable and flexible

2. **Submission versioning**
   - Track multiple submissions per activity
   - Add logic to select "latest" or "highest" score
   - Store submission timestamp

3. **Export functionality**
   - Add export button for lesson matrix with averages/levels
   - Include summary columns in Excel export

4. **Performance optimization**
   - Consider materialized views for frequently accessed aggregations
   - Add indexes on `submissions.activity_id` and `submissions.user_id`

---

## Conclusion

The unit progress reporting system now correctly uses submission-level scores instead of averaging individual success criteria feedback records. This ensures that reports accurately reflect the final calculated or overridden scores from the assignments system. The addition of average and level columns provides teachers with quick summary insights for each pupil's performance across a unit.
