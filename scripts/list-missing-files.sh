#!/bin/bash

# Script to list files that exist in database but are missing from file system

echo "Checking for missing files..."
echo "=============================="
echo ""

# Create temporary file for results
TEMP_FILE=$(mktemp)

# Get all files from database with lesson/activity context
docker exec postgres17 psql -U postgres -d postgres -t -A -F'|' <<'EOF' > "$TEMP_FILE"
SELECT
  u.unit_id,
  u.title as unit_title,
  l.lesson_id,
  l.title as lesson_title,
  a.activity_id,
  a.title as activity_title,
  a.type as activity_type,
  sf.file_name,
  sf.stored_path,
  sf.size_bytes
FROM stored_files sf
-- Extract lesson_id and activity_id from scope_path
-- Format: LESSON_ID/activities/ACTIVITY_ID or LESSON_ID/activities/ACTIVITY_ID/EMAIL
LEFT JOIN LATERAL (
  SELECT
    CASE
      WHEN sf.scope_path ~ '^[0-9a-f-]{36}/activities/[0-9a-f-]{36}'
        THEN (regexp_matches(sf.scope_path, '^([0-9a-f-]{36})/activities/([0-9a-f-]{36})'))[1]
      ELSE NULL
    END as lesson_id,
    CASE
      WHEN sf.scope_path ~ '^[0-9a-f-]{36}/activities/[0-9a-f-]{36}'
        THEN (regexp_matches(sf.scope_path, '^[0-9a-f-]{36}/activities/([0-9a-f-]{36})'))[1]
      ELSE NULL
    END as activity_id
) parsed ON true
LEFT JOIN lessons l ON l.lesson_id = parsed.lesson_id
LEFT JOIN activities a ON a.activity_id = parsed.activity_id
LEFT JOIN units u ON u.unit_id = l.unit_id
WHERE sf.bucket = 'lessons'
ORDER BY u.title NULLS LAST, l.title NULLS LAST, a.order_by NULLS LAST, sf.file_name;
EOF

# Check which files are missing
MISSING_COUNT=0
EXISTING_COUNT=0

echo "Unit | Lesson | Activity | Type | File Name | Size | Status"
echo "-----------------------------------------------------------"

while IFS='|' read -r unit_id unit_title lesson_id lesson_title activity_id activity_title activity_type file_name stored_path size_bytes; do
  # Skip empty lines
  [ -z "$stored_path" ] && continue

  FILE_PATH="files/$stored_path"

  if [ -f "$FILE_PATH" ]; then
    STATUS="✓ EXISTS"
    ((EXISTING_COUNT++))
  else
    STATUS="✗ MISSING"
    ((MISSING_COUNT++))

    # Format size
    if [ -n "$size_bytes" ] && [ "$size_bytes" != "" ]; then
      SIZE_KB=$((size_bytes / 1024))
      SIZE_DISPLAY="${SIZE_KB} KB"
    else
      SIZE_DISPLAY="unknown"
    fi

    # Truncate long titles
    unit_display="${unit_title:0:20}"
    lesson_display="${lesson_title:0:20}"
    activity_display="${activity_title:0:20}"

    echo "$unit_display | $lesson_display | $activity_display | $activity_type | $file_name | $SIZE_DISPLAY | $STATUS"
  fi
done < "$TEMP_FILE"

rm "$TEMP_FILE"

echo ""
echo "=============================="
echo "Summary:"
echo "  Existing files: $EXISTING_COUNT"
echo "  Missing files:  $MISSING_COUNT"
echo "=============================="

if [ $MISSING_COUNT -gt 0 ]; then
  echo ""
  echo "These files need to be re-uploaded through the lesson management interface."
fi
