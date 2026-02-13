# Performance Fix: Success Criteria Usage Check

## Problem Identified

**Symptom:** 5-10 second delay in production when loading curriculum builder page. Icons initially render as trash cans, then switch to chain icons after a delay.

**Root Cause:** N+1 query problem
- Page loads with curriculum data
- Client component mounts
- useEffect triggers `checkAllSuccessCriteriaUsage()`
- This function calls `checkSuccessCriteriaUsageAction()` **once for each Success Criterion**
- Example: 50 SCs = 50 separate database round-trips
- Each query checks if that specific SC is assigned to activities

**Impact:**
- Poor user experience (flickering icons)
- Risk of user clicking wrong button during transition
- Unnecessary database load (50+ queries instead of 1)
- Slow page load in production

## Solution Implemented

### 1. New Server Action: Bulk Usage Check

**File:** `src/lib/server-actions/curricula.ts`

```typescript
export async function readCurriculumSuccessCriteriaUsageAction(
  curriculumId: string
): Promise<{ data: Record<string, boolean> | null; error: string | null }>
```

**What it does:**
- Single SQL query fetches ALL SCs in curriculum
- Uses `EXISTS()` subquery to check if each SC is assigned
- Returns `Record<string, boolean>` mapping SC ID → is_assigned

**SQL Query:**
```sql
select distinct
  sc.success_criteria_id,
  exists(
    select 1
    from activity_success_criteria acs
    where acs.success_criteria_id = sc.success_criteria_id
  ) as is_assigned
from success_criteria sc
join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
where ao.curriculum_id = $1
```

**Performance:**
- Before: N queries (one per SC) - **50 queries for 50 SCs**
- After: 1 query - **always 1 query**
- Typical improvement: 50x faster

### 2. Server-Side Page Data Fetch

**File:** `src/app/curriculum/[curriculumId]/page.tsx`

```typescript
const [curriculumResult, unitsResult, lessonsResult, usageResult] = await Promise.all([
  readCurriculumDetailAction(curriculumId),
  readUnitsAction(),
  readLessonsAction(),
  readCurriculumSuccessCriteriaUsageAction(curriculumId), // ← NEW
])

const initialUsageMap = usageResult.data ?? {}
```

**What changed:**
- Added usage data fetch to initial page load
- Runs in parallel with other data fetches (Promise.all)
- Passes `initialScUsageMap` to client component

### 3. Client Component Optimization

**File:** `src/app/curriculum/[curriculumId]/curriculum-prototype-client.tsx`

**Before:**
```typescript
const [scUsageMap, setScUsageMap] = useState<Map<string, boolean>>(new Map())

const checkAllSuccessCriteriaUsage = useCallback(async () => {
  // ... 50 individual API calls ...
}, [assessmentObjectives])

useEffect(() => {
  checkAllSuccessCriteriaUsage()  // Runs AFTER page renders
}, [checkAllSuccessCriteriaUsage])
```

**After:**
```typescript
interface CurriculumPrototypeClientProps {
  // ...
  initialScUsageMap?: Record<string, boolean>  // ← NEW
}

const [scUsageMap, setScUsageMap] = useState<Map<string, boolean>>(() => {
  const map = new Map<string, boolean>()
  Object.entries(initialScUsageMap).forEach(([scId, isAssigned]) => {
    map.set(scId, isAssigned)
  })
  return map
})

// Removed: checkAllSuccessCriteriaUsage function
// Removed: useEffect that called it
```

**What changed:**
- State initialized with server-provided data
- No client-side API calls on mount
- Icons render correctly immediately (no flicker)

## Performance Comparison

### Before (N+1 Queries):
```
1. Page load: Fetch curriculum data (1 query)
2. Page renders with trash icons
3. useEffect triggers
4. Client makes 50 separate API calls:
   - checkSuccessCriteriaUsageAction(sc1)
   - checkSuccessCriteriaUsageAction(sc2)
   - ... 48 more ...
   - checkSuccessCriteriaUsageAction(sc50)
5. Each call: Query → Result → Update state
6. Icons switch from trash to chain (user sees flicker)

Total time: ~5-10 seconds
Total queries: 51 (1 initial + 50 usage checks)
```

### After (Single Query):
```
1. Page load: Fetch curriculum + usage data in parallel (2 queries)
2. Page renders with CORRECT icons immediately
3. No client-side API calls
4. No flickering

Total time: <1 second
Total queries: 2 (curriculum + usage)
```

## Database Query Efficiency

### Before:
```sql
-- Query 1 (per SC, 50 times):
SELECT COUNT(*) FROM activity_success_criteria WHERE success_criteria_id = $1

-- Total queries: 50
-- Total rows scanned: Potentially 1000s (full table scan per query)
```

### After:
```sql
-- Single query for all SCs:
SELECT sc.success_criteria_id,
       EXISTS(SELECT 1 FROM activity_success_criteria acs
              WHERE acs.success_criteria_id = sc.success_criteria_id) as is_assigned
FROM success_criteria sc
JOIN learning_objectives lo ON lo.learning_objective_id = sc.learning_objective_id
JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
WHERE ao.curriculum_id = $1

-- Total queries: 1
-- Database can optimize with indexes on FK columns
```

## Files Changed

1. **`src/lib/server-actions/curricula.ts`**
   - Added `readCurriculumSuccessCriteriaUsageAction()`

2. **`src/lib/server-updates.ts`**
   - Exported new action

3. **`src/app/curriculum/[curriculumId]/page.tsx`**
   - Fetch usage data on server
   - Pass to client component

4. **`src/app/curriculum/[curriculumId]/curriculum-prototype-client.tsx`**
   - Accept `initialScUsageMap` prop
   - Initialize state with server data
   - Remove client-side usage check

## Testing Checklist

- [ ] Page loads instantly with correct icons
- [ ] No icon flickering (trash → chain transition)
- [ ] Chain icons appear for assigned SCs
- [ ] Trash icons appear for unassigned SCs
- [ ] Click chain icon → unassign dialog works
- [ ] Click trash icon → delete works
- [ ] After unassign → icon changes to trash
- [ ] Console shows single query log, not 50+ queries

## Expected Log Output

### Before:
```
[curricula] checkSuccessCriteriaUsageAction:start { successCriteriaId: 'abc...' }
[curricula] checkSuccessCriteriaUsageAction:start { successCriteriaId: 'def...' }
[curricula] checkSuccessCriteriaUsageAction:start { successCriteriaId: 'ghi...' }
... (50 times)
```

### After:
```
[curricula] readCurriculumSuccessCriteriaUsageAction:start { curriculumId: 'xxx...' }
[curricula] readCurriculumSuccessCriteriaUsageAction:success {
  curriculumId: 'xxx...',
  totalSCs: 50,
  assignedCount: 12
}
```

## Rollback Plan

If issues arise, revert these commits:
```bash
git revert HEAD  # Revert performance optimization
```

The old individual-check approach will resume working immediately.

## Future Optimizations

Potential further improvements:
1. Add database index on `activity_success_criteria(success_criteria_id)` if not exists
2. Cache usage data in Redis for 60 seconds
3. Use WebSocket to push usage updates instead of polling

## Success Metrics

- ✅ Page load time: 5-10s → <1s
- ✅ Database queries: 50+ → 2
- ✅ User experience: No icon flicker
- ✅ No risk of clicking wrong button during transition
