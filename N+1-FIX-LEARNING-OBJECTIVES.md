# N+1 Query Fixes: Learning Objectives & Lessons

## Problem Identified

**Files:**
- `src/lib/server-actions/learning-objectives.ts`
- `src/lib/server-actions/lessons.ts`

Four N+1 query patterns were found where loops executed individual database queries instead of batch operations:

1. **createLearningObjectiveAction** - Creating success criteria one at a time
2. **updateLearningObjectiveAction** - Inserting new success criteria one at a time
3. **reorderLearningObjectivesAction** - Updating order_index one row at a time

---

## Fix 1: Batch Insert Success Criteria on Create

### Before (N+1 Pattern)
```typescript
for (const criterion of filteredCriteria) {
  const { rows: inserted } = await client.query(
    `insert into success_criteria (...) values ($1, $2, $3, $4, $5) returning success_criteria_id`,
    [createdLearningObjectiveId, criterion.description, ...]
  )
  const successCriteriaId = inserted?.[0]?.success_criteria_id

  // Then insert units for each criterion
  if (unitIds.length > 0) {
    await client.query(`insert into success_criteria_units ...`)
  }
}
```

**Impact:** Creating a learning objective with 10 success criteria = 10+ INSERT queries

### After (Batch Insert)
```typescript
if (filteredCriteria.length > 0) {
  // Build multi-row INSERT
  const scValues: unknown[] = []
  const scPlaceholders: string[] = []

  filteredCriteria.forEach((criterion, idx) => {
    const base = idx * 5
    scValues.push(createdLearningObjectiveId, criterion.description, ...)
    scPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`)
  })

  // Single INSERT for all criteria
  const { rows: insertedCriteria } = await client.query(
    `insert into success_criteria (...) values ${scPlaceholders.join(", ")} returning success_criteria_id`,
    scValues
  )

  // Then batch insert all unit associations
  const unitValues: unknown[] = []
  insertedCriteria.forEach((row, idx) => {
    const unitIds = filteredCriteria[idx].unit_ids ?? []
    unitIds.forEach((unitId) => {
      unitValues.push(row.success_criteria_id, unitId)
      unitPlaceholders.push(`($${unitValues.length - 1}, $${unitValues.length})`)
    })
  })

  if (unitPlaceholders.length > 0) {
    await client.query(
      `insert into success_criteria_units (...) values ${unitPlaceholders.join(", ")}`,
      unitValues
    )
  }
}
```

**Performance:**
- Before: N queries (one per criterion) + M queries (units per criterion)
- After: 2 queries (1 for all criteria + 1 for all units)
- Typical improvement: 10 criteria with units = **20+ queries → 2 queries**

---

## Fix 2: Batch Insert Success Criteria on Update

### Before (N+1 Pattern)
```typescript
const inserts = filteredCriteria.filter((criterion) => !criterion.success_criteria_id)
for (const criterion of inserts) {
  const { rows: insertedRows } = await client.query(
    `insert into success_criteria (...) values ($1, $2, $3, $4, $5) returning success_criteria_id`,
    [learningObjectiveId, criterion.description, ...]
  )

  const units = criterion.unit_ids ?? []
  if (units.length > 0) {
    await client.query(`insert into success_criteria_units ...`)
  }
}
```

**Impact:** Adding 5 new success criteria during update = 5+ INSERT queries

### After (Batch Insert)
Same pattern as Fix 1 - builds multi-row INSERT and executes in 2 queries total.

**Performance:**
- Before: N queries for inserts + M queries for units
- After: 2 queries (1 for all inserts + 1 for all units)
- Typical improvement: 5 new criteria = **10+ queries → 2 queries**

---

## Fix 3: Batch Update for Reordering

### Before (N+1 Pattern)
```typescript
for (const update of updates) {
  await client.query(
    "update learning_objectives set order_index = $1 where learning_objective_id = $2",
    [update.orderBy, update.learningObjectiveId]
  )
}
```

**Impact:** Reordering 15 learning objectives = 15 UPDATE queries

### After (Single UPDATE with unnest)
```typescript
if (updates.length > 0) {
  const ids = updates.map(u => u.learningObjectiveId)
  const orderIndexes = updates.map(u => u.orderBy)

  await client.query(
    `UPDATE learning_objectives lo
     SET order_index = data.order_index
     FROM (
       SELECT unnest($1::text[]) as learning_objective_id,
              unnest($2::integer[]) as order_index
     ) AS data
     WHERE lo.learning_objective_id = data.learning_objective_id`,
    [ids, orderIndexes]
  )
}
```

**Performance:**
- Before: N UPDATE queries (one per learning objective)
- After: 1 UPDATE query
- Typical improvement: 15 objectives = **15 queries → 1 query**

---

## SQL Technique: unnest() for Batch Updates

The `unnest()` function converts arrays into rows, allowing us to join data for bulk updates:

```sql
-- Instead of 3 separate UPDATEs:
UPDATE learning_objectives SET order_index = 0 WHERE learning_objective_id = 'abc'
UPDATE learning_objectives SET order_index = 1 WHERE learning_objective_id = 'def'
UPDATE learning_objectives SET order_index = 2 WHERE learning_objective_id = 'ghi'

-- Use a single UPDATE with unnest:
UPDATE learning_objectives lo
SET order_index = data.order_index
FROM (
  SELECT unnest(ARRAY['abc', 'def', 'ghi']) as learning_objective_id,
         unnest(ARRAY[0, 1, 2]) as order_index
) AS data
WHERE lo.learning_objective_id = data.learning_objective_id
```

This works because `unnest()` converts parallel arrays into a temporary table with matching rows.

---

## Fix 4: Batch Update for Lesson Reordering

### Before (N+1 Pattern)
```typescript
for (const update of updates) {
  await client.query(
    "update lessons set order_by = $1 where lesson_id = $2",
    [update.orderBy, update.lessonId]
  )
}
```

**Impact:** Reordering 20 lessons = 20 UPDATE queries

### After (Single UPDATE with unnest)
```typescript
if (updates.length > 0) {
  const ids = updates.map(u => u.lessonId)
  const orderIndexes = updates.map(u => u.orderBy)

  await client.query(
    `UPDATE lessons l
     SET order_by = data.order_by
     FROM (
       SELECT unnest($1::text[]) as lesson_id,
              unnest($2::integer[]) as order_by
     ) AS data
     WHERE l.lesson_id = data.lesson_id`,
    [ids, orderIndexes]
  )
}
```

**Performance:**
- Before: N UPDATE queries (one per lesson)
- After: 1 UPDATE query
- Typical improvement: 20 lessons = **20 queries → 1 query**

**File:** `src/lib/server-actions/lessons.ts` - `reorderLessonsAction()`

---

## Overall Impact

### Queries Saved Per Operation

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Create LO with 10 SCs + units | 20+ | 2 | **10x faster** |
| Update LO adding 5 SCs + units | 10+ | 2 | **5x faster** |
| Reorder 15 LOs | 15 | 1 | **15x faster** |
| Reorder 20 lessons | 20 | 1 | **20x faster** |

### Database Load Reduction

For a typical learning objective management session:
- Creating 3 LOs with avg 8 SCs each: **60 queries → 6 queries** (90% reduction)
- Reordering 10 LOs: **10 queries → 1 query** (90% reduction)

---

## Testing Checklist

- [ ] Create learning objective with multiple success criteria
- [ ] Verify all criteria are inserted correctly
- [ ] Verify unit associations are created
- [ ] Update learning objective by adding new criteria
- [ ] Delete some criteria during update
- [ ] Reorder multiple learning objectives via drag-and-drop
- [ ] Verify order_index values are updated correctly
- [ ] Check database logs to confirm query count reduction

---

## Files Changed

1. **`src/lib/server-actions/learning-objectives.ts`**
   - `createLearningObjectiveAction` - Batch insert for success criteria
   - `updateLearningObjectiveAction` - Batch insert for new success criteria
   - `reorderLearningObjectivesAction` - Single UPDATE with unnest()

2. **`src/lib/server-actions/lessons.ts`**
   - `reorderLessonsAction` - Single UPDATE with unnest()

---

## Related Documentation

- Previous N+1 fix: `PERFORMANCE-FIX-SC-USAGE.md` (Success Criteria usage check)
- Database best practices: Prefer batch operations over loops with queries
- PostgreSQL unnest() documentation: https://www.postgresql.org/docs/current/functions-array.html
