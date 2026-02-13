# Level Calculation System

## Overview

The system converts percentage scores to educational levels based on year group (Years 7-11). Levels range from `0` to `9M`, with subdivisions: **L** (Low), **M** (Medium), **H** (High).

**Core Principle:** Older students need lower percentages to achieve the same level because expectations increase with age.

**Application:** Levels are based on assessment/summative scores, not total scores. Levels are only calculated at the unit level, not for other layers of the hierarchy.

---

## Complete Level Thresholds

| Level | Year 7 | Year 8 | Year 9 | Year 10 | Year 11 |
|-------|--------|--------|--------|---------|---------|
| **0**   | 0%     | 0%     | 0%     | 0%      | 0%      |
| **1L**  | 6%     | 6%     | 5%     | 4%      | 4%      |
| **1M**  | 11%    | 11%    | 10%    | 8%      | 7%      |
| **1H**  | 17%    | 17%    | 14%    | 12%     | 11%     |
| **2L**  | 22%    | 22%    | 19%    | 16%     | 14%     |
| **2M**  | 33%    | 28%    | 24%    | 20%     | 18%     |
| **2H**  | 40%    | 33%    | 29%    | 24%     | 21%     |
| **3L**  | 47%    | 39%    | 33%    | 28%     | 25%     |
| **3M**  | 53%    | 44%    | 38%    | 32%     | 29%     |
| **3H**  | 60%    | 50%    | 43%    | 36%     | 32%     |
| **4L**  | 67%    | 56%    | 48%    | 40%     | 36%     |
| **4M**  | 73%    | 61%    | 52%    | 44%     | 39%     |
| **4H**  | 80%    | 67%    | 57%    | 48%     | 43%     |
| **5L**  | 87%    | 72%    | 62%    | 52%     | 46%     |
| **5M**  | 93%    | 78%    | 67%    | 56%     | 50%     |
| **5H**  | —      | 83%    | 71%    | 60%     | 54%     |
| **6L**  | —      | 89%    | 76%    | 64%     | 57%     |
| **6M**  | —      | 94%    | 81%    | 68%     | 61%     |
| **6H**  | —      | —      | 86%    | 72%     | 64%     |
| **7L**  | —      | —      | 90%    | 76%     | 68%     |
| **7M**  | —      | —      | 95%    | 80%     | 71%     |
| **7H**  | —      | —      | —      | 84%     | 75%     |
| **8L**  | —      | —      | —      | 88%     | 79%     |
| **8M**  | —      | —      | —      | 92%     | 82%     |
| **8H**  | —      | —      | —      | 96%     | 86%     |
| **9L**  | —      | —      | —      | —       | 89%     |
| **9M**  | —      | —      | —      | —       | 93%     |

---

## Examples

**Year 7:**
- 54% → **3M**
- 60% → **3H**
- 93% → **5M** (maximum achievable)

**Year 8:**
- 60% → **4M** (higher than Year 7's 3H)
- 73% → **5L**
- 94% → **6M** (maximum achievable)

**Year 11:**
- 60% → **5L** (much higher than Year 7's 3H)
- 89% → **9L**
- 93% → **9M** (maximum achievable)

---

## Key Observations

### 1. Maximum Attainable Levels by Year

- **Year 7:** Up to **5M** (93%)
- **Year 8:** Up to **6M** (94%)
- **Year 9:** Up to **7M** (95%)
- **Year 10:** Up to **8H** (96%)
- **Year 11:** Up to **9M** (93%)

**Implication:** A Year 7 student scoring 100% cannot achieve a level higher than 5M. This creates a ceiling effect that provides natural progression incentive as students age.

### 2. Progressive Scaling Across Year Groups

The percentage gap between year groups widens at higher levels:

| Level | Y7 → Y8 | Y8 → Y9 | Y9 → Y10 | Y10 → Y11 |
|-------|---------|---------|----------|-----------|
| **2M** | -5%     | -4%     | -4%      | -2%       |
| **3M** | -9%     | -6%     | -6%      | -3%       |
| **4M** | -12%    | -9%     | -8%      | -5%       |
| **5M** | -15%    | -11%    | -11%     | -6%       |

**Implication:** The relative difficulty of achieving the same level increases more dramatically in middle school (Years 7-9) than in later years.

### 3. Common Score Comparisons

**What level does 50% achieve?**
- Year 7: **3M**
- Year 8: **3H**
- Year 9: **4L**
- Year 10: **4M**
- Year 11: **5L**

**What level does 75% achieve?**
- Year 7: **4M**
- Year 8: **5L**
- Year 9: **5H**
- Year 10: **7L**
- Year 11: **7H**

**What level does 90% achieve?**
- Year 7: **5L**
- Year 8: **6L**
- Year 9: **7L**
- Year 10: **8L**
- Year 11: **9L**

### 4. Threshold Consistency Patterns

**Lower levels (1L-2L)** show minimal variation across year groups:
- 1L: 6% → 6% → 5% → 4% → 4%
- 2L: 22% → 22% → 19% → 16% → 14%

**Mid-range levels (3L-5M)** show increasing differentiation:
- 3L: 47% → 39% → 33% → 28% → 25% (22% total gap)
- 5M: 93% → 78% → 67% → 56% → 50% (43% total gap)

**Implication:** The system is more forgiving at lower achievement levels and increasingly discriminates at higher achievement levels.

### 5. Same Score, Different Levels

A **60% score** yields different levels across year groups:
- Year 7: **3H** (Level 9 on 0-26 scale)
- Year 8: **4M** (Level 11)
- Year 9: **4L** (Level 10)
- Year 10: **4M** (Level 11)
- Year 11: **5L** (Level 13)

**5 level-point difference** between Year 7 and Year 11 for the same percentage.

### 6. Ceiling Effects in Detail

**Year 7 students:**
- Cannot achieve levels 5H and above
- Maximum score (100%) = Level 5M
- Blocks access to 11 higher levels (5H through 9M)

**Year 8 students:**
- Cannot achieve levels 6H and above
- Need 94% to reach maximum (6M)
- Blocks access to 9 higher levels

**Year 11 students:**
- Can access all 26 levels
- Need 93% to reach maximum (9M)
- Top achievers can distinguish themselves across wider range

---

## Implementation

### Location
`src/lib/levels/index.ts`

### Main Function

```typescript
getLevelForYearScore(year: number | null, score: number | null): string | null
```

**Parameters:**
- `year`: Student's year group (7-11)
- `score`: Raw score as decimal (0-1) or percentage (0-100)

**Returns:**
- Level string (e.g., "3M", "4H")
- `null` if year or score is invalid

**Algorithm:**
1. Validate and round year to integer (7-11)
2. Convert score to percentage if needed (multiplies by 100 if ≤ 1)
3. Look up year-specific boundaries from `LEVEL_BOUNDARIES_BY_YEAR`
4. Find highest level where `score >= threshold`
5. Return matched level or lowest level if no match

**Example usage:**
```typescript
getLevelForYearScore(7, 0.54)  // Returns "3M" (54% for Year 7)
getLevelForYearScore(8, 73)    // Returns "5L" (73% for Year 8)
getLevelForYearScore(11, 0.89) // Returns "9L" (89% for Year 11)
getLevelForYearScore(7, 100)   // Returns "5M" (ceiling for Year 7)
```

### Helper Function

```typescript
getLevelBoundariesForYear(year: number): LevelBoundary[]
```

Returns all boundaries for a specific year, useful for displaying level ranges or creating visualizations.

**Example:**
```typescript
getLevelBoundariesForYear(7)
// Returns:
// [
//   { level: "0", minPercent: 0 },
//   { level: "1L", minPercent: 6 },
//   { level: "1M", minPercent: 11 },
//   ...
//   { level: "5M", minPercent: 93 }
// ]
```

---

## Data Structure

Thresholds are defined in `LEVEL_BOUNDARY_ROWS` as an array of objects:

```typescript
const LEVEL_BOUNDARY_ROWS = [
  {
    level: "0",
    thresholds: { 7: 0, 8: 0, 9: 0, 10: 0, 11: 0 },
  },
  {
    level: "3M",
    thresholds: { 7: 53, 8: 44, 9: 38, 10: 32, 11: 29 },
  },
  // ... etc
] as const
```

At module initialization, this is transformed into `LEVEL_BOUNDARIES_BY_YEAR`:

```typescript
{
  7: [
    { level: "0", minPercent: 0 },
    { level: "1L", minPercent: 6 },
    { level: "1M", minPercent: 11 },
    // ... up to { level: "5M", minPercent: 93 }
  ],
  8: [ /* ... */ ],
  9: [ /* ... */ ],
  10: [ /* ... */ ],
  11: [ /* ... */ ]
}
```

Each year's boundaries are sorted by `minPercent` ascending for efficient lookup via linear search.

---

## Maintenance Notes

### To Update Threshold Scale

1. Edit `LEVEL_BOUNDARY_ROWS` in `src/lib/levels/index.ts`
2. The boundaries are automatically regenerated on module import
3. No database migrations needed (calculation is runtime)
4. Update this documentation file to reflect changes

### Adding New Year Groups

- Extend `YearGroup` type definition
- Add threshold values to relevant level rows
- Initialize new year in `LEVEL_BOUNDARIES_BY_YEAR`

### Adding New Levels

- Append new level objects to `LEVEL_BOUNDARY_ROWS`
- Ensure thresholds are in ascending order
- Follow naming convention: number + L/M/H suffix
- Update maximum attainable levels documentation

### Testing Changes

After modifying thresholds, verify:
- Edge cases at boundaries (e.g., exactly 60%)
- Year transitions (same score across years)
- Maximum levels for each year
- Invalid inputs (null, negative, >100%)

---

## Usage in Application

The level system is currently used in:
- **Unit-level reports** - Converting summative scores to levels
- **Progress tracking** - Showing achievement relative to year group expectations
- **Assessment feedback** - Contextualizing raw scores with standardized levels

**Not used for:**
- Individual lesson scores
- Activity-level feedback
- Overall curriculum-wide averages
