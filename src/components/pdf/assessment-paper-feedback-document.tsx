import React from "react"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

import type { ClassFeedbackPdfData, ClassFeedbackStatus } from "@/lib/assessment-paper/class-feedback-pdf"
import type { FeedbackPdfCriterion, FeedbackPdfData, FeedbackPdfQuestion } from "@/lib/assessment-paper/feedback-pdf"

/**
 * One pupil's feedback on an assessment paper: A4 landscape, the overall marks
 * first, then a table with a row per question in paper order: the question,
 * the pupil's answer, the mark scheme when the paper allows it, the marks and
 * how to improve. The class document puts a cover in front of several pupils'
 * pages, and is a teacher copy: it adds the AI's marks against the teacher's.
 */

const BORDER = "#d4d4d8"
const MUTED = "#52525b"
const RED = "#dc2626"
const NO_ANSWER = "No answer submitted"

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 36, fontSize: 10, fontFamily: "Helvetica", color: "#18181b" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: 6, marginBottom: 12 },
  headerText: { fontSize: 8, color: MUTED },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 },
  pupilName: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, color: MUTED, marginTop: 2 },
  totalMarks: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  overall: { marginBottom: 10, padding: 8, backgroundColor: "#f4f4f5", borderRadius: 3 },
  label: { fontSize: 8, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase", marginBottom: 2 },
  questionLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  questionMarks: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  block: { marginTop: 5 },
  muted: { color: MUTED },
  small: { fontSize: 8, marginTop: 2 },
  answerImage: { marginTop: 4, maxHeight: 300, objectFit: "contain", borderWidth: 1, borderColor: BORDER },
  table: { borderTopWidth: 1, borderTopColor: BORDER },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  headRow: { backgroundColor: "#f4f4f5" },
  cell: { paddingVertical: 5, paddingHorizontal: 5 },
  colQuestion: { flex: 3 },
  colAnswer: { flex: 4 },
  colMarkScheme: { flex: 4 },
  colMarks: { flex: 1.1 },
  colImprove: { flex: 4 },
  coverTable: { marginTop: 14 },
  coverRow: { flexDirection: "row", gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: BORDER },
  coverHeadRow: { borderBottomColor: MUTED },
  coverName: { flex: 3 },
  coverMarks: { flex: 1, textAlign: "right" },
  coverStatus: { flex: 2, paddingLeft: 8 },
  changes: { marginBottom: 10, padding: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 3 },
  footer: { position: "absolute", bottom: 16, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
})

function marks(awarded: number | null, available: number) {
  return `${awarded === null ? "—" : awarded} / ${available}`
}

/** A change in marks: +2, -1 or 0. */
function signed(value: number) {
  return value > 0 ? `+${value}` : `${value}`
}

/** What the pupil should do next: the teacher's comment, else the marker's advice. */
function improvementText(feedback: FeedbackPdfCriterion["feedback"]): string | null {
  if (!feedback) return null
  return (feedback.source === "teacher" ? feedback.text : feedback.howToImprove)?.trim() || null
}

function questionImprovements(question: FeedbackPdfQuestion): string[] {
  const texts = question.legacy
    ? [improvementText(question.legacy.feedback)]
    : question.criteria.map((criterion) => improvementText(criterion.feedback))
  return [...new Set(texts.filter((text): text is string => Boolean(text)))]
}

function AnswerCell({ answer, powerPoint }: { answer: FeedbackPdfQuestion["answer"]; powerPoint: boolean }) {
  // A PowerPoint task's work is in the pupil's files, not on a script.
  if (!answer) return <Text style={styles.muted}>{powerPoint ? "In your files" : "—"}</Text>
  if (answer.status === "blank") return <Text style={{ color: RED }}>{NO_ANSWER}</Text>
  return (
    <>
      {answer.status === "unreadable" ? (
        <Text style={styles.muted}>This answer was hard to read, so it is shown as you wrote it.</Text>
      ) : null}
      {answer.transcription?.trim() ? <Text>{answer.transcription.trim()}</Text> : null}
      {answer.images.map((image) => (
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
        <Image key={image.pageNumber} src={image.src} style={styles.answerImage} />
      ))}
    </>
  )
}

function QuestionTable({ questions, powerPoint }: { questions: FeedbackPdfQuestion[]; powerPoint: boolean }) {
  const showMarkScheme = questions.some((question) => question.markScheme)
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headRow]} wrap={false}>
        <Text style={[styles.cell, styles.colQuestion, styles.label]}>{powerPoint ? "Task" : "Question"}</Text>
        <Text style={[styles.cell, styles.colAnswer, styles.label]}>Your answer</Text>
        {showMarkScheme ? <Text style={[styles.cell, styles.colMarkScheme, styles.label]}>Mark scheme</Text> : null}
        <Text style={[styles.cell, styles.colMarks, styles.label]}>Marks</Text>
        <Text style={[styles.cell, styles.colImprove, styles.label]}>How to improve</Text>
      </View>
      {questions.map((question) => (
        <View key={question.label} style={styles.row} wrap={Boolean(question.answer?.images.length)}>
          <View style={[styles.cell, styles.colQuestion]}>
            <Text style={styles.questionLabel}>{question.label}</Text>
            {question.questionText?.trim() ? <Text style={styles.small}>{question.questionText.trim()}</Text> : null}
          </View>
          <View style={[styles.cell, styles.colAnswer]}>
            <AnswerCell answer={question.answer} powerPoint={powerPoint} />
          </View>
          {showMarkScheme ? (
            <View style={[styles.cell, styles.colMarkScheme]}>
              <Text style={styles.small}>{question.markScheme ?? ""}</Text>
            </View>
          ) : null}
          <View style={[styles.cell, styles.colMarks]}>
            <Text style={[styles.questionMarks, (question.awarded ?? 0) === 0 ? { color: RED } : {}]}>
              {marks(question.awarded, question.maxMarks)}
            </Text>
          </View>
          <View style={[styles.cell, styles.colImprove]}>
            {questionImprovements(question).map((text, index) => (
              <Text key={index} style={index > 0 ? styles.block : undefined}>{text}</Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

/**
 * Teacher copy only (the class document): the questions where the teacher
 * changed the AI's marks. Absent from a pupil's own PDF, which never carries
 * teacherChanges, and omitted when no AI mark is on record.
 */
function TeacherChangesBox({ changes, maxMarks }: { changes: FeedbackPdfData["teacherChanges"]; maxMarks: number }) {
  if (!changes?.recorded) return null
  return (
    <View style={styles.changes} wrap={false}>
      <Text style={styles.label}>Teacher changes</Text>
      <Text style={styles.muted}>
        {`AI ${changes.aiMarks} / ${maxMarks} -> Final ${changes.finalMarks} / ${maxMarks} (${signed(changes.change)})`}
      </Text>
      {changes.changedQuestions.length === 0 ? <Text>No changes to the AI&apos;s marks.</Text> : null}
      {changes.changedQuestions.map((question) => (
        <Text key={question.label}>
          {`${question.label}: AI ${question.aiAwarded}/${question.available} -> Teacher ${question.finalAwarded}/${question.available}`}
        </Text>
      ))}
      {changes.teacherOnlyLabels.length > 0 ? (
        <Text style={styles.small}>
          {`Marked by the teacher alone (no AI mark, same in both totals): ${changes.teacherOnlyLabels.join(", ")}`}
        </Text>
      ) : null}
    </View>
  )
}

/** One pupil's pages: also a section of the class document. */
function PupilFeedbackPage({ data }: { data: FeedbackPdfData }) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.header} fixed>
        <Text style={styles.headerText}>{data.paperTitle}</Text>
        <Text style={styles.headerText}>{[data.pupilName, data.className].filter(Boolean).join("  ·  ")}</Text>
      </View>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.pupilName}>{data.pupilName}</Text>
          <Text style={styles.subtitle}>{[data.className, data.paperTitle].filter(Boolean).join("  ·  ")}</Text>
        </View>
        <Text style={styles.totalMarks}>
          {data.marksAwarded === null ? "Not marked yet" : `${data.marksAwarded} / ${data.maxMarks} marks`}
        </Text>
      </View>

      <TeacherChangesBox changes={data.teacherChanges} maxMarks={data.maxMarks} />

      {data.overallFeedback ? (
        <View style={styles.overall}>
          <Text style={styles.label}>Your teacher&apos;s comment</Text>
          <Text>{data.overallFeedback}</Text>
        </View>
      ) : null}

      {data.questions.length === 0 ? (
        <Text style={styles.muted}>{data.powerPoint ? "This assessment has no tasks yet." : "This paper has no questions yet."}</Text>
      ) : null}
      {data.questions.length > 0 ? <QuestionTable questions={data.questions} powerPoint={data.powerPoint} /> : null}

      <Footer paperTitle={data.paperTitle} />
    </Page>
  )
}

function Footer({ paperTitle }: { paperTitle: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{paperTitle}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

export function AssessmentPaperFeedbackDocument({ data }: { data: FeedbackPdfData }) {
  return (
    <Document title={`${data.paperTitle} - feedback`}>
      <PupilFeedbackPage data={data} />
    </Document>
  )
}

const STATUS_LABEL: Record<ClassFeedbackStatus, string> = {
  marked: "Marked",
  "not yet marked": "Not yet marked",
  held: "Held (front sheet check failed)",
  "not sat": "Not sat",
}

/** A PowerPoint assessment has no front sheet, and is handed in rather than sat. */
const POWERPOINT_STATUS_LABEL: Record<ClassFeedbackStatus, string> = {
  marked: "Marked",
  "not yet marked": "Not yet marked",
  held: "Held",
  "not sat": "Not handed in",
}

/**
 * A class's feedback on one paper: a cover with every pupil's marks and
 * status, then each pupil who sat it on their own pages, as in their own PDF.
 */
export function AssessmentPaperClassFeedbackDocument({ data }: { data: ClassFeedbackPdfData }) {
  return (
    <Document title={`${data.paperTitle} - ${data.className} feedback`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.headerText}>{data.paperTitle}</Text>
          <Text style={styles.headerText}>{data.className}</Text>
        </View>

        <Text style={styles.pupilName}>{data.paperTitle}</Text>
        <Text style={styles.subtitle}>
          {[`Class ${data.className}`, `Unit ${data.unitTitle}`, `Generated ${data.generatedOn}`].join("  ·  ")}
        </Text>

        <View style={styles.coverTable}>
          <View style={[styles.coverRow, styles.coverHeadRow]} fixed>
            <Text style={[styles.coverName, styles.label]}>Pupil</Text>
            <Text style={[styles.coverMarks, styles.label]}>AI mark</Text>
            <Text style={[styles.coverMarks, styles.label]}>Final mark</Text>
            <Text style={[styles.coverMarks, styles.label]}>Change</Text>
            <Text style={[styles.coverStatus, styles.label]}>Status</Text>
          </View>
          {data.roster.length === 0 ? <Text style={[styles.block, styles.muted]}>This class has no pupils.</Text> : null}
          {data.roster.map((row, index) => (
            <View key={index} style={styles.coverRow} wrap={false}>
              <Text style={styles.coverName}>{row.pupilName}</Text>
              <Text style={styles.coverMarks}>{row.aiMarks === null ? "—" : marks(row.aiMarks, data.maxMarks)}</Text>
              <Text style={styles.coverMarks}>{row.status === "not sat" ? "—" : marks(row.marksAwarded, data.maxMarks)}</Text>
              <Text style={styles.coverMarks}>{row.change === null ? "—" : signed(row.change)}</Text>
              <Text style={[styles.coverStatus, row.status === "marked" ? {} : styles.muted]}>{(data.powerPoint ? POWERPOINT_STATUS_LABEL : STATUS_LABEL)[row.status]}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.block, styles.muted]}>
          {data.changes.comparable === 0
            ? "No AI marks on record to compare with the final marks."
            : `Teacher changed marks for ${data.changes.changed} of ${data.changes.comparable} AI-marked pupil${data.changes.comparable === 1 ? "" : "s"}; net change ${signed(data.changes.net)} mark${Math.abs(data.changes.net) === 1 ? "" : "s"}.`}
        </Text>
        <Text style={[styles.small, styles.muted]}>
          AI mark: the {data.powerPoint ? "assessment" : "paper"}&apos;s marks with every teacher change taken out (marks the teacher gave alone count the same in both). — where none is on record.
        </Text>

        <Footer paperTitle={data.paperTitle} />
      </Page>

      {data.pupils.map((pupil, index) => (
        <PupilFeedbackPage key={index} data={pupil} />
      ))}
    </Document>
  )
}
