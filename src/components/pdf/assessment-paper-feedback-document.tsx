import React from "react"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

import type { ClassFeedbackPdfData, ClassFeedbackStatus, ClassQuestionAnalysisRow } from "@/lib/assessment-paper/class-feedback-pdf"
import type { FeedbackPdfCriterion, FeedbackPdfData, FeedbackPdfQuestion } from "@/lib/assessment-paper/feedback-pdf"

/**
 * One pupil's feedback on an assessment paper: A4 landscape, the overall marks
 * first, then a table with a row per question in paper order: the question,
 * the pupil's answer, the mark scheme when the paper allows it, the marks and
 * how to improve. The class document puts a cover in front of several pupils'
 * pages, and is a teacher copy: it adds the AI's marks against the teacher's,
 * and a question analysis between the cover and the pupils' pages.
 */

const BORDER = "#d4d4d8"
const MUTED = "#52525b"
const RED = "#dc2626"
const NO_ANSWER = "No answer submitted"
const ANALYSIS_LABEL_WIDTH = 80
const ANALYSIS_BAR_WIDTH = 520
// The pupil-by-question grid: A4 landscape leaves 770pt across; the name
// column takes 120, so 36 columns of 18pt fit, and 28 pupils of 13pt down
// under the heading, key and rotated question labels.
const GRID_NAME_WIDTH = 120
const GRID_CELL = 18
const GRID_ROW_HEIGHT = 13
const GRID_HEAD_HEIGHT = 44
const GRID_COLUMNS_PER_PAGE = 36
const GRID_ROWS_PER_PAGE = 28

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
  coverPercent: { flex: 0.6, textAlign: "right" },
  coverStatus: { flex: 2, paddingLeft: 8 },
  key: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8, marginBottom: 6 },
  keyItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  keySwatch: { width: 10, height: 10, borderWidth: 0.5, borderColor: MUTED },
  analysisRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 1 },
  analysisHeadRow: { borderBottomWidth: 1, borderBottomColor: MUTED, paddingBottom: 3, marginBottom: 2 },
  analysisLabel: { width: ANALYSIS_LABEL_WIDTH, fontSize: 9 },
  analysisBar: { width: ANALYSIS_BAR_WIDTH, height: 11, flexDirection: "row", borderWidth: 0.5, borderColor: MUTED },
  analysisSegment: { height: "100%", justifyContent: "center", alignItems: "center" },
  analysisSegmentText: { fontSize: 7, fontFamily: "Helvetica-Bold" },
  analysisCounts: { flex: 1, fontSize: 8 },
  gridRow: { flexDirection: "row", alignItems: "center" },
  gridName: { width: GRID_NAME_WIDTH, fontSize: 8, paddingRight: 6, maxLines: 1, textOverflow: "ellipsis" },
  gridHeadCell: { width: GRID_CELL, height: GRID_HEAD_HEIGHT, position: "relative" },
  // Rotated to read upwards, centred on its column: a box as long as the
  // column head is tall, turned about its centre.
  gridHeadText: {
    position: "absolute",
    width: GRID_HEAD_HEIGHT,
    left: (GRID_CELL - GRID_HEAD_HEIGHT) / 2,
    top: GRID_HEAD_HEIGHT / 2 - 4,
    height: 8,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    transform: "rotate(-90deg)",
  },
  gridCell: {
    width: GRID_CELL,
    height: GRID_ROW_HEIGHT,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
  gridCellText: { fontSize: 6.5, fontFamily: "Helvetica-Bold" },
  gridTotalRow: { marginTop: 3, paddingTop: 3, borderTopWidth: 1, borderTopColor: MUTED },
  gridPercent: { width: GRID_CELL, fontSize: 6, textAlign: "center" },
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
 * The question analysis's categories (questionOutcome in results.ts), in bar
 * order. Each is a step lighter than the one before, so they stay apart in
 * greyscale print: dark green, red, amber, light grey.
 */
const OUTCOMES: Array<{ key: keyof ClassQuestionAnalysisRow["counts"]; label: string; fill: string; text: string }> = [
  { key: "full", label: "Full marks", fill: "#14532d", text: "#ffffff" },
  { key: "partial", label: "Partial marks", fill: "#f59e0b", text: "#18181b" },
  { key: "zero", label: "Attempted, no marks", fill: "#dc2626", text: "#ffffff" },
  { key: "blank", label: "Did not attempt", fill: "#e4e4e7", text: "#18181b" },
]

const OUTCOME_LOOK = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<
  keyof ClassQuestionAnalysisRow["counts"],
  (typeof OUTCOMES)[number]
>

/** A count is written inside its segment when the segment is at least this wide (points). */
const MIN_SEGMENT_FOR_TEXT = 14

function AnalysisBar({ row, pupils }: { row: ClassQuestionAnalysisRow; pupils: number }) {
  return (
    <View style={styles.analysisBar}>
      {OUTCOMES.map((outcome) => {
        const count = row.counts[outcome.key]
        if (count === 0 || pupils === 0) return null
        const width = (count / pupils) * ANALYSIS_BAR_WIDTH
        return (
          <View key={outcome.key} style={[styles.analysisSegment, { width, backgroundColor: outcome.fill }]}>
            {width >= MIN_SEGMENT_FOR_TEXT ? (
              <Text style={[styles.analysisSegmentText, { color: outcome.text }]}>{count}</Text>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function OutcomeKey() {
  return (
    <View style={styles.key}>
      {OUTCOMES.map((outcome) => (
        <View key={outcome.key} style={styles.keyItem}>
          <View style={[styles.keySwatch, { backgroundColor: outcome.fill }]} />
          <Text style={{ fontSize: 8 }}>{outcome.label}</Text>
        </View>
      ))}
    </View>
  )
}

function outcomeNote(data: ClassFeedbackPdfData) {
  return `Did not attempt: a blank answer, a ${data.powerPoint ? "task" : "question"} not read yet, or no work ${data.powerPoint ? "handed in" : "sat"}. Attempted, no marks: an answer that scored 0 or is not marked yet.`
}

/** The class sheets' page header, title, subtitle and colour key, repeated on each of their pages. */
function SheetHeading({ data, title, subtitle, note }: { data: ClassFeedbackPdfData; title: string; subtitle: string; note?: string }) {
  return (
    <>
      <View style={styles.header} fixed>
        <Text style={styles.headerText}>{data.paperTitle}</Text>
        <Text style={styles.headerText}>{data.className}</Text>
      </View>
      <View fixed>
        <Text style={styles.totalMarks}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <OutcomeKey />
        {note ? <Text style={[styles.small, styles.muted, { marginTop: 0, marginBottom: 6 }]}>{note}</Text> : null}
      </View>
    </>
  )
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/**
 * After the cover: a pupil per row, a question per column, each cell
 * coloured by the pupil's outcome with their mark in it, and a "% correct"
 * row. Columns that do not fit across the page go on further pages, each
 * repeating the pupils' names; rows that do not fit go on further pages,
 * each repeating the question headings. The % correct row closes each block
 * of columns. Pages are laid out here rather than left to wrap, so that a
 * block's columns line up on every page.
 */
function PupilQuestionGridPages({ data }: { data: ClassFeedbackPdfData }) {
  const columnBlocks = chunk(
    data.questions.map((question, index) => ({ question, index })),
    GRID_COLUMNS_PER_PAGE,
  )
  const rowBlocks = data.roster.length > 0 ? chunk(data.roster, GRID_ROWS_PER_PAGE) : [[]]
  const subtitle = `Class ${data.className}  ·  ${data.roster.length} pupil${data.roster.length === 1 ? "" : "s"}, from each pupil's latest attempt and final marks; the mark is in each cell`
  if (columnBlocks.length === 0) {
    return (
      <Page size="A4" orientation="landscape" style={styles.page}>
        <SheetHeading data={data} title="Pupil by question" subtitle={subtitle} />
        <Text style={[styles.block, styles.muted]}>{data.powerPoint ? "This assessment has no tasks yet." : "This paper has no questions yet."}</Text>
        <Footer paperTitle={data.paperTitle} />
      </Page>
    )
  }
  return (
    <>
      {columnBlocks.flatMap((columns, blockIndex) =>
        rowBlocks.map((pupils, rowIndex) => {
          const last = rowIndex === rowBlocks.length - 1
          const range =
            columnBlocks.length > 1
              ? `  ·  ${data.powerPoint ? "tasks" : "questions"} ${columns[0].question.label} to ${columns[columns.length - 1].question.label}`
              : ""
          return (
            <Page key={`${blockIndex}-${rowIndex}`} size="A4" orientation="landscape" style={styles.page}>
              <SheetHeading data={data} title="Pupil by question" subtitle={subtitle + range} />
              <View style={styles.gridRow}>
                <Text style={[styles.gridName, styles.label, { alignSelf: "flex-end", marginBottom: 2 }]}>Pupil</Text>
                {columns.map(({ question, index }) => (
                  <View key={index} style={styles.gridHeadCell}>
                    <Text style={styles.gridHeadText}>{question.label}</Text>
                  </View>
                ))}
              </View>
              {pupils.map((row, index) => (
                <View key={index} style={styles.gridRow}>
                  <Text style={styles.gridName}>{row.pupilName}</Text>
                  {columns.map(({ index: q }) => {
                    const cell = row.cells[q]
                    const look = OUTCOME_LOOK[cell.outcome]
                    return (
                      <View key={q} style={[styles.gridCell, { backgroundColor: look.fill }]}>
                        {cell.outcome !== "blank" && cell.awarded !== null ? (
                          <Text style={[styles.gridCellText, { color: look.text }]}>{cell.awarded}</Text>
                        ) : null}
                      </View>
                    )
                  })}
                </View>
              ))}
              {last ? (
                <View style={[styles.gridRow, styles.gridTotalRow]}>
                  <Text style={[styles.gridName, { fontFamily: "Helvetica-Bold" }]}>% correct</Text>
                  {columns.map(({ question, index }) => (
                    <Text key={index} style={styles.gridPercent}>{question.percentCorrect === null ? "—" : `${question.percentCorrect}%`}</Text>
                  ))}
                </View>
              ) : null}
              {last ? (
                <Text style={[styles.small, styles.muted, { marginTop: 6 }]}>
                  {`% correct: the marks every pupil above earned on the ${data.powerPoint ? "task" : "question"} over its marks times ${data.roster.length}; no mark counts 0. ${outcomeNote(data)}`}
                </Text>
              ) : null}
              <Footer paperTitle={data.paperTitle} />
            </Page>
          )
        }),
      )}
    </>
  )
}

/**
 * Then one row per question with a 100% bar of the class's pupils by
 * outcome. The heading, key and column heads repeat on every page.
 */
function QuestionAnalysisPages({ data }: { data: ClassFeedbackPdfData }) {
  const pupils = data.roster.length
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <SheetHeading
        data={data}
        title="Question analysis"
        subtitle={`Class ${data.className}  ·  ${pupils} pupil${pupils === 1 ? "" : "s"} in each bar, from each pupil's latest attempt and final marks`}
        note={outcomeNote(data)}
      />
      <View style={[styles.analysisRow, styles.analysisHeadRow]} fixed>
        <Text style={[styles.analysisLabel, styles.label, { marginBottom: 0 }]}>{data.powerPoint ? "Task" : "Question"}</Text>
        <Text style={[styles.label, { width: ANALYSIS_BAR_WIDTH, marginBottom: 0 }]}>Pupils (100%)</Text>
        <Text style={[styles.analysisCounts, styles.label, { marginBottom: 0 }]}>Counts, in key order</Text>
      </View>

      {data.questions.length === 0 ? (
        <Text style={[styles.block, styles.muted]}>{data.powerPoint ? "This assessment has no tasks yet." : "This paper has no questions yet."}</Text>
      ) : null}
      {data.questions.map((row, index) => (
        <View key={index} style={styles.analysisRow} wrap={false}>
          <Text style={styles.analysisLabel}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{row.label}</Text>
            <Text style={styles.muted}>{`  ${row.available} mark${row.available === 1 ? "" : "s"}`}</Text>
          </Text>
          <AnalysisBar row={row} pupils={pupils} />
          <Text style={styles.analysisCounts}>{OUTCOMES.map((o) => row.counts[o.key]).join(" / ")}</Text>
        </View>
      ))}

      <Footer paperTitle={data.paperTitle} />
    </Page>
  )
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
            <Text style={[styles.coverPercent, styles.label]}>%</Text>
            <Text style={[styles.coverMarks, styles.label]}>Change</Text>
            <Text style={[styles.coverStatus, styles.label]}>Status</Text>
          </View>
          {data.roster.length === 0 ? <Text style={[styles.block, styles.muted]}>This class has no pupils.</Text> : null}
          {data.roster.map((row, index) => (
            <View key={index} style={styles.coverRow} wrap={false}>
              <Text style={styles.coverName}>{row.pupilName}</Text>
              <Text style={styles.coverMarks}>{row.aiMarks === null ? "—" : marks(row.aiMarks, data.maxMarks)}</Text>
              <Text style={styles.coverMarks}>{row.status === "not sat" ? "—" : marks(row.marksAwarded, data.maxMarks)}</Text>
              <Text style={styles.coverPercent}>{row.percent === null ? "—" : `${row.percent}%`}</Text>
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

      <PupilQuestionGridPages data={data} />
      <QuestionAnalysisPages data={data} />

      {data.pupils.map((pupil, index) => (
        <PupilFeedbackPage key={index} data={pupil} />
      ))}
    </Document>
  )
}
