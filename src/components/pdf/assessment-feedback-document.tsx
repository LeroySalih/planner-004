import React from "react"
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

import type { AssessmentPaperHeader, AssessmentPaperObjective, AssessmentPupilResult } from "@/types"

/**
 * Printable feedback for a whole paper: A4 landscape, one pupil per page (a
 * long sheet continues onto further pages, but the next pupil always starts a
 * fresh one), so the pack can be printed once and handed out.
 */

export type AssessmentFeedbackDocumentProps = {
  paper: AssessmentPaperHeader
  objectives: AssessmentPaperObjective[]
  pupils: AssessmentPupilResult[]
}

const BORDER = "#d4d4d8"
const MUTED = "#52525b"

const styles = StyleSheet.create({
  page: { paddingTop: 24, paddingBottom: 36, paddingHorizontal: 28, fontSize: 9, fontFamily: "Helvetica", color: "#18181b" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: 6, marginBottom: 10 },
  headerText: { fontSize: 8, color: MUTED },
  pupilRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
  pupilName: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  totals: { alignItems: "flex-end" },
  totalMarks: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  totalNote: { fontSize: 8, color: MUTED },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4, marginTop: 6 },
  table: { borderWidth: 1, borderColor: BORDER, borderBottomWidth: 0 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: "#f4f4f5" },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  headCell: { paddingVertical: 3, paddingHorizontal: 4, fontFamily: "Helvetica-Bold", fontSize: 8 },
  barTrack: { height: 7, backgroundColor: "#e4e4e7", borderRadius: 2, marginTop: 2 },
  barFill: { height: 7, borderRadius: 2 },
  list: { marginBottom: 2 },
  footer: { position: "absolute", bottom: 14, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
})

// Question table column widths, as percentages of the row.
const Q_COLS = { label: "16%", lo: "6%", marks: "8%", answer: "18%", why: "26%", how: "26%" } as const
const LO_COLS = { code: "7%", title: "53%", marks: "12%", percent: "8%", bar: "20%" } as const

function pupilName(pupil: AssessmentPupilResult): string {
  return [pupil.first_name, pupil.last_name].filter(Boolean).join(" ") || "Unnamed pupil"
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-")
  return day && month && year ? `${day}-${month}-${year}` : isoDate
}

function percentOf(awarded: number, available: number): number | null {
  return available > 0 ? Math.round((awarded / available) * 100) : null
}

function barColour(percent: number): string {
  if (percent >= 70) return "#16a34a"
  if (percent >= 40) return "#f59e0b"
  return "#dc2626"
}

function PupilSheet({ paper, objectives, pupil }: { paper: AssessmentPaperHeader; objectives: AssessmentPaperObjective[]; pupil: AssessmentPupilResult }) {
  const subtotalByCode = new Map(pupil.objectives.map((o) => [o.code, o]))
  const name = pupilName(pupil)

  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.header} fixed>
        <Text style={styles.headerText}>{paper.title}</Text>
        <Text style={styles.headerText}>
          {[formatDate(paper.assessed_on), paper.group_ids.join(", "), paper.curriculum_title].filter(Boolean).join("  ·  ")}
        </Text>
      </View>

      <View style={styles.pupilRow}>
        <Text style={styles.pupilName}>{name}</Text>
        <View style={styles.totals}>
          <Text style={styles.totalMarks}>
            {pupil.total_awarded} / {pupil.total_available} marks  ·  {pupil.percent}%
          </Text>
          {pupil.marked_questions < pupil.question_count && (
            <Text style={styles.totalNote}>
              {pupil.marked_questions} of {pupil.question_count} questions marked
            </Text>
          )}
        </View>
      </View>

      <Text style={styles.sectionTitle}>How you did on each learning objective</Text>
      <View style={styles.table}>
        <View style={styles.headRow}>
          <Text style={[styles.headCell, { width: LO_COLS.code }]}>LO</Text>
          <Text style={[styles.headCell, { width: LO_COLS.title }]}>Learning objective</Text>
          <Text style={[styles.headCell, { width: LO_COLS.marks }]}>Marks</Text>
          <Text style={[styles.headCell, { width: LO_COLS.percent }]}>%</Text>
          <Text style={[styles.headCell, { width: LO_COLS.bar }]}> </Text>
        </View>
        {objectives.map((objective) => {
          const subtotal = subtotalByCode.get(objective.code)
          const percent = subtotal ? percentOf(subtotal.awarded, subtotal.available) : null
          return (
            <View key={objective.code} style={styles.row} wrap={false}>
              <Text style={[styles.cell, { width: LO_COLS.code, fontFamily: "Helvetica-Bold" }]}>{objective.code}</Text>
              <Text style={[styles.cell, { width: LO_COLS.title }]}>{objective.title}</Text>
              <Text style={[styles.cell, { width: LO_COLS.marks }]}>
                {subtotal && subtotal.available > 0 ? `${subtotal.awarded} / ${subtotal.available}` : "—"}
              </Text>
              <Text style={[styles.cell, { width: LO_COLS.percent }]}>{percent === null ? "—" : `${percent}%`}</Text>
              <View style={[styles.cell, { width: LO_COLS.bar }]}>
                {percent !== null && (
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.max(percent, 2)}%`, backgroundColor: barColour(percent) }]} />
                  </View>
                )}
              </View>
            </View>
          )
        })}
      </View>

      {(pupil.went_well.length > 0 || pupil.targets.length > 0) && (
        <View style={{ flexDirection: "row", gap: 16 }}>
          {pupil.went_well.length > 0 && (
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>What went well</Text>
              {pupil.went_well.map((item, index) => (
                <Text key={index} style={styles.list}>•  {item}</Text>
              ))}
            </View>
          )}
          {pupil.targets.length > 0 && (
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Targets</Text>
              {pupil.targets.map((item, index) => (
                <Text key={index} style={styles.list}>•  {item}</Text>
              ))}
            </View>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Question by question</Text>
      <View style={styles.table}>
        <View style={styles.headRow} fixed>
          <Text style={[styles.headCell, { width: Q_COLS.label }]}>Question</Text>
          <Text style={[styles.headCell, { width: Q_COLS.lo }]}>LO</Text>
          <Text style={[styles.headCell, { width: Q_COLS.marks }]}>Marks</Text>
          <Text style={[styles.headCell, { width: Q_COLS.answer }]}>Correct answer</Text>
          <Text style={[styles.headCell, { width: Q_COLS.why }]}>Why marks were not awarded</Text>
          <Text style={[styles.headCell, { width: Q_COLS.how }]}>How to improve</Text>
        </View>
        {pupil.questions.map((question) => (
          <View key={question.label} style={styles.row} wrap={false}>
            <Text style={[styles.cell, { width: Q_COLS.label }]}>{question.label}</Text>
            <Text style={[styles.cell, { width: Q_COLS.lo }]}>{question.objective_code}</Text>
            <Text style={[styles.cell, { width: Q_COLS.marks }]}>
              {question.awarded === null ? "—" : `${question.awarded} / ${question.max_marks}`}
            </Text>
            <Text style={[styles.cell, { width: Q_COLS.answer }]}>{question.correct_answer ?? ""}</Text>
            <Text style={[styles.cell, { width: Q_COLS.why }]}>{question.why_not_awarded ?? ""}</Text>
            <Text style={[styles.cell, { width: Q_COLS.how }]}>{question.how_to_improve ?? ""}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer} fixed>
        <Text>{name}</Text>
        <Text render={({ subPageNumber, subPageTotalPages }) => subPageTotalPages > 1 ? `Page ${subPageNumber} of ${subPageTotalPages}` : ""} />
      </View>
    </Page>
  )
}

export function AssessmentFeedbackDocument({ paper, objectives, pupils }: AssessmentFeedbackDocumentProps) {
  return (
    <Document title={`${paper.title} - feedback`}>
      {pupils.length === 0 ? (
        <Page size="A4" orientation="landscape" style={styles.page}>
          <Text style={styles.pupilName}>{paper.title}</Text>
          <Text>No pupil has any marks on this paper yet.</Text>
        </Page>
      ) : (
        pupils.map((pupil) => <PupilSheet key={pupil.pupil_id} paper={paper} objectives={objectives} pupil={pupil} />)
      )}
    </Document>
  )
}
