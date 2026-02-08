#!/bin/bash

# Simple script to list files that exist in database but are missing from file system

# Help function
show_help() {
  cat << EOF
================================================================================
Missing Files Report Script
================================================================================

DESCRIPTION:
    This script identifies files that exist in the database but are missing
    from the file system. It helps you determine which files need to be
    re-uploaded after a database restore or file system issue.

USAGE:
    ./scripts/list-missing-files-simple.sh [OPTIONS]

OPTIONS:
    -h, --help, /help    Show this help message and exit
    --quiet              Show only the summary (no detailed file list)
    --csv                Output in CSV format for spreadsheet import

EXAMPLES:
    # Run the script and view results
    ./scripts/list-missing-files-simple.sh

    # Save full report to a file
    ./scripts/list-missing-files-simple.sh > missing-files-report.txt

    # Show only summary
    ./scripts/list-missing-files-simple.sh --quiet

    # Export as CSV for Excel/Google Sheets
    ./scripts/list-missing-files-simple.sh --csv > missing-files.csv

OUTPUT FORMAT:
    For each missing file, the script displays:
    - File name and size
    - Unit name
    - Lesson name
    - Activity name and type
    - Full storage path

    At the end, a summary shows:
    - Number of existing files (in DB and on disk)
    - Number of missing files (in DB but not on disk)
    - Total files in database

REQUIREMENTS:
    - Docker container 'postgres17' must be running
    - Must be run from project root directory
    - Requires read access to 'files/' directory

NOTES:
    - Files in the database but not on disk need to be re-uploaded
    - Re-upload through the lesson management interface in the web app
    - The script is read-only and makes no changes to database or files

================================================================================
EOF
  exit 0
}

# Parse command line arguments
QUIET_MODE=false
CSV_MODE=false

for arg in "$@"; do
  case $arg in
    -h|--help|/help)
      show_help
      ;;
    --quiet)
      QUIET_MODE=true
      shift
      ;;
    --csv)
      CSV_MODE=true
      shift
      ;;
    *)
      # Unknown option
      ;;
  esac
done

# Start main script
if [ "$CSV_MODE" = false ] && [ "$QUIET_MODE" = false ]; then
  echo "Checking for missing files..."
  echo "=============================="
  echo ""
fi

# CSV header
if [ "$CSV_MODE" = true ]; then
  echo "Status,File Name,Size (KB),Unit,Lesson,Activity,Type,Path"
fi

# Create temporary file for results
TEMP_FILE=$(mktemp)

# Get all files from database
docker exec postgres17 psql -U postgres -d postgres -t -A -F'|' -c \
  "SELECT file_name, stored_path, size_bytes, scope_path FROM stored_files WHERE bucket = 'lessons' ORDER BY stored_path;" \
  > "$TEMP_FILE"

# Check which files are missing
MISSING_COUNT=0
EXISTING_COUNT=0

if [ "$CSV_MODE" = false ] && [ "$QUIET_MODE" = false ]; then
  echo "Missing Files Report"
  echo "===================="
  echo ""
fi

while IFS='|' read -r file_name stored_path size_bytes scope_path; do
  # Skip empty lines
  [ -z "$stored_path" ] && continue

  FILE_PATH="files/$stored_path"

  if [ -f "$FILE_PATH" ]; then
    ((EXISTING_COUNT++))
  else
    ((MISSING_COUNT++))

    # Format size
    if [ -n "$size_bytes" ] && [ "$size_bytes" != "" ] && [ "$size_bytes" != "0" ]; then
      SIZE_KB=$((size_bytes / 1024))
      SIZE_DISPLAY="${SIZE_KB} KB"
    else
      SIZE_DISPLAY="unknown"
    fi

    # Extract lesson and activity IDs from scope_path
    if [[ $scope_path =~ ^([0-9a-f-]{36})/activities/([0-9a-f-]{36}) ]]; then
      LESSON_ID="${BASH_REMATCH[1]}"
      ACTIVITY_ID="${BASH_REMATCH[2]}"

      # Get lesson and activity details
      DETAILS=$(docker exec postgres17 psql -U postgres -d postgres -t -A -F'|' -c \
        "SELECT COALESCE(u.title, 'Unknown'), COALESCE(l.title, 'Unknown'), COALESCE(a.title, 'Untitled'), COALESCE(a.type, 'unknown')
         FROM lessons l
         LEFT JOIN units u ON u.unit_id = l.unit_id
         LEFT JOIN activities a ON a.activity_id = '$ACTIVITY_ID'
         WHERE l.lesson_id = '$LESSON_ID' LIMIT 1;")

      if [ -n "$DETAILS" ]; then
        IFS='|' read -r unit_title lesson_title activity_title activity_type <<< "$DETAILS"

        if [ "$CSV_MODE" = true ]; then
          # CSV format
          echo "MISSING,\"$file_name\",\"$SIZE_DISPLAY\",\"$unit_title\",\"$lesson_title\",\"$activity_title\",\"$activity_type\",\"$stored_path\""
        elif [ "$QUIET_MODE" = false ]; then
          echo "✗ MISSING: $file_name ($SIZE_DISPLAY)"
          echo "  Unit: $unit_title"
          echo "  Lesson: $lesson_title"
          echo "  Activity: $activity_title ($activity_type)"
          echo "  Path: $stored_path"
          echo ""
        fi
      else
        if [ "$CSV_MODE" = true ]; then
          echo "MISSING,\"$file_name\",\"$SIZE_DISPLAY\",\"\",\"\",\"\",\"\",\"$stored_path\""
        elif [ "$QUIET_MODE" = false ]; then
          echo "✗ MISSING: $file_name ($SIZE_DISPLAY)"
          echo "  Path: $stored_path"
          echo ""
        fi
      fi
    else
      if [ "$CSV_MODE" = true ]; then
        echo "MISSING,\"$file_name\",\"$SIZE_DISPLAY\",\"\",\"\",\"\",\"\",\"$stored_path\""
      elif [ "$QUIET_MODE" = false ]; then
        echo "✗ MISSING: $file_name ($SIZE_DISPLAY)"
        echo "  Path: $stored_path"
        echo ""
      fi
    fi
  fi
done < "$TEMP_FILE"

rm "$TEMP_FILE"

echo ""
echo "=============================="
echo "Summary:"
echo "  Existing files: $EXISTING_COUNT"
echo "  Missing files:  $MISSING_COUNT"
echo "  Total files:    $((EXISTING_COUNT + MISSING_COUNT))"
echo "=============================="

if [ $MISSING_COUNT -gt 0 ]; then
  echo ""
  echo "These files need to be re-uploaded through the lesson management interface."
  if [ "$CSV_MODE" = false ]; then
    echo ""
    echo "Tip: Use --csv to export as CSV, or --quiet to show only the summary"
  fi
fi
