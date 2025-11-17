-- Comprehensive index audit: tune read-heavy paths across planner domains

-- Group membership lookups (by pupil, by group)
create index if not exists idx_group_membership_user_group
  on public.group_membership (user_id, group_id);

create index if not exists idx_group_membership_group_user
  on public.group_membership (group_id, user_id);

-- Human-friendly join code access
create unique index if not exists idx_groups_join_code_unique
  on public.groups (join_code)
  where join_code is not null;

-- Lesson composition (unit listings, lesson detail hydration)
create index if not exists idx_lessons_unit_order
  on public.lessons (unit_id, order_by, lesson_id);

create index if not exists idx_lessons_learning_objective_lesson_order
  on public.lessons_learning_objective (lesson_id, order_by, learning_objective_id);

create index if not exists idx_lesson_assignments_lesson_group
  on public.lesson_assignments (lesson_id, group_id, start_date);

create index if not exists idx_lesson_links_lesson
  on public.lesson_links (lesson_id, lesson_link_id);

-- Activity drill-down (lesson and success-criterion joins)
create index if not exists idx_activities_lesson_order
  on public.activities (lesson_id, order_by, activity_id);

create index if not exists idx_activity_success_criteria_success_activity
  on public.activity_success_criteria (success_criteria_id, activity_id);

-- Curriculum alignment helpers
create index if not exists idx_success_criteria_units_unit
  on public.success_criteria_units (unit_id, success_criteria_id);

-- Feedback dashboards (per-lesson aggregation)
create index if not exists idx_feedback_lesson_user
  on public.feedback (lesson_id, user_id);

-- Submission querying (by activity timeline, by learner)
create unique index if not exists idx_submissions_submission_id_unique
  on public.submissions (submission_id);

create index if not exists idx_submissions_activity_submitted
  on public.submissions (activity_id, submitted_at desc);

create index if not exists idx_submissions_activity_user
  on public.submissions (activity_id, user_id);
