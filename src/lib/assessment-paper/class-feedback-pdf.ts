import "server-only"

import { createElement } from "react"
import type { ReactElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import type { DocumentProps } from "@react-pdf/renderer"
import { format } from "date-fns"

import { query } from "@/lib/db"
import { isPowerPointAssessmentType } from "@/dino.config"
import { readAssessmentFeedbackPdfData, type FeedbackPdfData } from "@/lib/assessment-paper/feedback-pdf"
import { pupilMembershipSql } from "@/lib/roles/pupil-membership"
import { AssessmentPaperClassFeedbackDocument } from "@/components/pdf/assessment-paper-feedback-document"

// One class's feedback on an assessment paper in one PDF, for a teacher: a
// cover listing every pupil of the class with their marks and where their
// paper is, then each pupil's feedback exactly as their own PDF has it
// (feedback-pdf.ts). Built when it is downloaded, from each pupil's latest
// attempt. Teacher-only, so the pupil-facing feedback visibility does not
// apply, and it shows the AI's marks against the teacher's
// (summariseTeacherChanges): never on a pupil's own PDF.
//
// On a PowerPoint assessment a pupil has "not sat" it (Not handed in) until
// their latest submission is handed in, and is "held" when marking stopped
// with a reason (mark_status null, mark_error set): a file missing or
// unreadable. Only handed-in pupils get feedback pages.

export type ClassFeedbackStatus = "marked" | "not yet marked" | "held" | "not sat"

export type ClassFeedbackRosterRow = {
  pupilName: string
  marksAwarded: number | null
  /** The AI's marks before the teacher's changes; null when not recorded. */
  aiMarks: number | null
  /** marksAwarded - aiMarks; null when not recorded. */
  change: number | null
  status: ClassFeedbackStatus
}

export type ClassFeedbackPdfData = {
  paperTitle: string
  /** A PowerPoint assessment: statuses read as handed in, not sat. */
  powerPoint: boolean
  className: string
  unitTitle: string
  /** DD-MM-YYYY. */
  generatedOn: string
  maxMarks: number
  /** Every pupil of the class, by last name then first name. */
  roster: ClassFeedbackRosterRow[]
  /** Pupils with an AI mark on record, how many of them the teacher changed, and the net change. */
  changes: { comparable: number; changed: number; net: number }
  /** The pupils with a submission, in roster order. */
  pupils: FeedbackPdfData[]
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function paperTitleOf(title: string | null) {
  return title?.trim() || "Assessment paper"
}

type RosterRow = {
  submission_id: string | null
  submission_status: string | null
  mark_status: string | null
  mark_error: string | null
  front_sheet_check: string | null
}

/** Whether the pupil has work to give feedback on. */
function hasSat(row: RosterRow, powerPoint: boolean) {
  return Boolean(row.submission_id) && (!powerPoint || row.submission_status === "submitted")
}

function rosterStatus(row: RosterRow, powerPoint: boolean): ClassFeedbackStatus {
  if (!hasSat(row, powerPoint)) return "not sat"
  if (powerPoint) {
    if (row.mark_status === "marked") return "marked"
    return row.mark_status === null && row.mark_error ? "held" : "not yet marked"
  }
  if (row.front_sheet_check !== null && row.front_sheet_check !== "passed") return "held"
  return row.mark_status === "marked" ? "marked" : "not yet marked"
}

export async function readClassFeedbackPdfData(activityId: string, groupId: string): Promise<ClassFeedbackPdfData> {
  const { rows: activityRows } = await query<{
    title: string | null
    type: string | null
    max_marks: number | null
    unit_title: string | null
    unit_id: string
  }>(
    `select a.title, a.type, a.max_marks, u.title as unit_title, u.unit_id
       from activities a
       join lessons l on l.lesson_id = a.lesson_id
       join units u on u.unit_id = l.unit_id
      where a.activity_id = $1`,
    [activityId],
  )
  const activity = activityRows[0]
  if (!activity) throw new Error("Activity not found.")
  const powerPoint = isPowerPointAssessmentType(activity.type)

  const { rows } = await query<
    RosterRow & { pupil_id: string; first_name: string | null; last_name: string | null; marks: number | null }
  >(
    `select p.user_id as pupil_id, p.first_name, p.last_name,
            l.submission_id, l.submission_status, l.marks, l.mark_status, l.mark_error, sc.front_sheet_check
       from group_membership gm
       join profiles p on p.user_id = gm.user_id
       left join lateral (
         select s.submission_id, s.submission_status, (s.body::jsonb ->> 'marks')::int as marks,
                s.mark_status, s.mark_error
           from submissions s
          where s.activity_id = $1 and s.user_id = p.user_id
          order by s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
          limit 1
       ) l on true
       left join lateral (
         select sc.front_sheet_check from assessment_scripts sc
          where sc.activity_id = $1 and sc.pupil_id = p.user_id and sc.submission_id = l.submission_id
          order by sc.uploaded_at desc, sc.script_id desc
          limit 1
       ) sc on true
      where gm.group_id = $2 and ${pupilMembershipSql("gm")}
      order by p.last_name nulls last, p.first_name nulls last, p.user_id`,
    [activityId, groupId],
  )

  const pupils: FeedbackPdfData[] = []
  const changesOf = new Map<string, NonNullable<FeedbackPdfData["teacherChanges"]>>()
  for (const row of rows) {
    if (!hasSat(row, powerPoint)) continue
    const pupil = await readAssessmentFeedbackPdfData(activityId, row.pupil_id, { teacherCopy: true })
    if (pupil.teacherChanges) changesOf.set(row.pupil_id, pupil.teacherChanges)
    pupils.push({ ...pupil, className: groupId })
  }
  const comparable = Array.from(changesOf.values()).filter((c) => c.recorded)

  return {
    paperTitle: paperTitleOf(activity.title),
    powerPoint,
    className: groupId,
    unitTitle: activity.unit_title?.trim() || activity.unit_id,
    generatedOn: format(new Date(), "dd-MM-yyyy"),
    maxMarks: Number(activity.max_marks) || 0,
    roster: rows.map((row) => ({
      pupilName: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Pupil",
      marksAwarded: row.marks === null ? null : Number(row.marks),
      aiMarks: changesOf.get(row.pupil_id)?.aiMarks ?? null,
      change: changesOf.get(row.pupil_id)?.recorded ? changesOf.get(row.pupil_id)!.change : null,
      status: rosterStatus(row, powerPoint),
    })),
    changes: {
      comparable: comparable.length,
      changed: comparable.filter((c) => c.changedQuestions.length > 0).length,
      net: comparable.reduce((sum, c) => sum + c.change, 0),
    },
    pupils,
  }
}

/** `<paper-title>-<class>-feedback.pdf`, slugified. */
export function classFeedbackFileName(activityTitle: string | null, className: string): string {
  const title = slug(paperTitleOf(activityTitle)).slice(0, 60).replace(/-$/, "") || "assessment"
  return `${title}-${slug(className) || "class"}-feedback.pdf`
}

export async function renderClassFeedbackPdf(
  activityId: string,
  groupId: string,
): Promise<{ data: ClassFeedbackPdfData; buffer: Buffer; fileName: string }> {
  const data = await readClassFeedbackPdfData(activityId, groupId)
  const element = createElement(AssessmentPaperClassFeedbackDocument, { data }) as unknown as ReactElement<DocumentProps>
  const buffer = await renderToBuffer(element)
  return { data, buffer, fileName: classFeedbackFileName(data.paperTitle, data.className) }
}
