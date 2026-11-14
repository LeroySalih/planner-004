#!/usr/bin/env bash
# Repairs AI criterion comments that a model mangled while writing JSON and
# that reached pupils before model-output-guard learned to refuse them:
#
#   * a comment that is only `Correct "` (or `Correct "”`, `Correct ""`): the
#     rest of the sentence was lost. It becomes `Correct`.
#   * a complete comment ending in a quote nothing opened (`…criterion.'`) or
#     in digits after its full stop (`…is met.0`): the stray end is removed.
#
# Only provenance 'ai' rows in submission_sc_marks are changed, and the same
# text is mended in the submission's cached body.ai_model_feedback. Marks are
# never touched.
#
#   bash scripts/fix-garbled-ai-comments.sh            dry run: lists what would change
#   bash scripts/fix-garbled-ai-comments.sh --apply    makes the change (backs up first)
#
# Run from the project directory on the server, with the db container up.
# DB_NAME overrides the database (default dino).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
DB_NAME="${DB_NAME:-dino}"

fail() { printf '\033[31mfix-garbled-ai-comments: %s\033[0m\n' "$1" >&2; exit 1; }

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    *) fail "usage: $0 [--apply]" ;;
  esac
done

docker compose ps db --status running -q | grep -q . || fail "the db container is not running"

if $APPLY; then
  bash scripts/backup-db.sh
  echo "backup: $(ls -t backups/*dino* 2>/dev/null | head -1)"
  END="commit"
else
  END="rollback"
fi

docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -X -q -U "$POSTGRES_USER" -d "$1"' sh "$DB_NAME" <<SQL
begin;

create temp table garbled on commit drop as
select m.submission_id, m.success_criteria_id, m.feedback as old_feedback,
       case
         -- Only "Correct" and stray quotes: the explanation was lost.
         when m.feedback ~ '^\s*Correct\s*["“”]+\s*$' then 'Correct'
         -- Digits straight after the closing full stop.
         when m.feedback ~ '[A-Za-z)\]''"’”][.!?][0-9]+\s*$'
           then regexp_replace(m.feedback, '([.!?])[0-9]+\s*$', '\1')
         -- A closing " with an odd number of " in the comment.
         when m.feedback ~ '[.!?]"\s*$'
           and (length(m.feedback) - length(replace(m.feedback, '"', ''))) % 2 = 1
           then regexp_replace(m.feedback, '"\s*$', '')
         -- A closing ” with no “ anywhere.
         when m.feedback ~ '[.!?]”\s*$' and position('“' in m.feedback) = 0
           then regexp_replace(m.feedback, '”\s*$', '')
         -- A closing ' or ’ after the full stop, with no quote opened earlier
         -- (an apostrophe inside a word, as in "isn't", is not an opening).
         when m.feedback ~ '[.!?][''’]\s*$'
           and m.feedback !~ '(^|[[:space:](\[])[''’]'
           then regexp_replace(m.feedback, '[''’]\s*$', '')
       end as new_feedback
from submission_sc_marks m
where m.provenance = 'ai' and m.feedback is not null;

delete from garbled where new_feedback is null or new_feedback = old_feedback;

\echo
\echo 'AI comments to repair, by activity (no pupil names):'
select u.title as unit, l.title as lesson, coalesce(nullif(btrim(a.title), ''), '(untitled)') as activity,
       count(*) as comments,
       count(*) filter (where g.new_feedback = 'Correct') as lost_to_correct
from garbled g
join submissions s on s.submission_id = g.submission_id
join activities a on a.activity_id = s.activity_id
join lessons l on l.lesson_id = a.lesson_id
join units u on u.unit_id = l.unit_id
group by 1, 2, 3
order by 1, 2, 3;

\echo 'Each change (end of the comment, before -> after):'
select right(old_feedback, 50) as before, right(new_feedback, 50) as after from garbled order by new_feedback = 'Correct' desc, old_feedback;

update submission_sc_marks m
set feedback = g.new_feedback
from garbled g
where m.submission_id = g.submission_id and m.success_criteria_id = g.success_criteria_id;

-- The cached comment on the submission joins the criterion comments with
-- blank lines, so mend the same paragraph there.
update submissions s
set body = jsonb_set(
  s.body::jsonb,
  '{ai_model_feedback}',
  to_jsonb(fixed.text)
)::json
from (
  select s2.submission_id,
         (select string_agg(
                   coalesce((select g.new_feedback from garbled g
                             where g.submission_id = s2.submission_id and g.old_feedback = p.para limit 1),
                            p.para),
                   E'\n\n' order by p.n)
          from regexp_split_to_table(s2.body->>'ai_model_feedback', E'\n\n') with ordinality as p(para, n)) as text
  from submissions s2
  where s2.submission_id in (select submission_id from garbled)
    and s2.body->>'ai_model_feedback' is not null
) fixed
where s.submission_id = fixed.submission_id
  and fixed.text is distinct from s.body->>'ai_model_feedback';

\echo 'Rows changed:'
select (select count(*) from garbled) as criterion_comments,
       (select count(distinct submission_id) from garbled) as submissions;

${END};
SQL

if $APPLY; then
  echo "Applied."
else
  echo "Dry run: nothing changed. Re-run with --apply to make the change."
fi
