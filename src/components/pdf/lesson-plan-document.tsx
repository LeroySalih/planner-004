// src/components/pdf/lesson-plan-document.tsx
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

// ---- Types ----------------------------------------------------------------

export interface PdfSuccessCriterion {
  id: string
  description: string
}

export interface PdfLearningObjective {
  id: string
  title: string
  criteria: PdfSuccessCriterion[]
}

export interface PdfActivityBase {
  id: string
  title: string
  orderBy: number | null
}

export interface PdfMcqActivity extends PdfActivityBase {
  kind: "mcq"
  question: string
  options: { id: string; text: string }[]
  correctOptionId: string
  imageDataUri: string | null
}

export interface PdfShortTextActivity extends PdfActivityBase {
  kind: "short-text"
  question: string
  modelAnswer: string
}

export interface PdfImageActivity extends PdfActivityBase {
  kind: "image"
  imageDataUri: string | null
}

export interface PdfVideoActivity extends PdfActivityBase {
  kind: "video"
  videoUrl: string
  thumbnailDataUri: string | null
  qrDataUri: string | null
}

export interface PdfTextActivity extends PdfActivityBase {
  kind: "text"
  content: string
}

export interface PdfKeyTermsActivity extends PdfActivityBase {
  kind: "key-terms"
  terms: { term: string; definition: string }[]
}

export interface PdfOtherActivity extends PdfActivityBase {
  kind: "other"
}

export type PdfActivity =
  | PdfMcqActivity
  | PdfShortTextActivity
  | PdfImageActivity
  | PdfVideoActivity
  | PdfTextActivity
  | PdfKeyTermsActivity
  | PdfOtherActivity

export interface LessonPlanDocumentProps {
  unitTitle: string
  lessonTitle: string
  generatedAt: string
  learningObjectives: PdfLearningObjective[]
  activities: PdfActivity[]
}

// ---- Styles ---------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 42,
    paddingRight: 42,
  },
  header: {
    backgroundColor: "#1e293b",
    borderRadius: 6,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  unitLabel: {
    fontSize: 8,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  unitTitle: {
    fontSize: 11,
    color: "#cbd5e1",
  },
  lessonTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    marginTop: 8,
  },
  generatedDate: {
    fontSize: 8,
    color: "#64748b",
    textAlign: "right",
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 10,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  section: {
    marginBottom: 24,
  },
  loBlock: {
    marginBottom: 12,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#cbd5e1",
  },
  loTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 4,
  },
  scItem: {
    flexDirection: "row",
    marginBottom: 3,
    paddingLeft: 8,
  },
  scBullet: {
    fontSize: 9,
    color: "#64748b",
    marginRight: 4,
  },
  scText: {
    fontSize: 9,
    color: "#475569",
    flex: 1,
  },
  activityBlock: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  activityTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 6,
  },
  activityTypeBadge: {
    fontSize: 7,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  questionText: {
    fontSize: 10,
    color: "#1e293b",
    marginBottom: 8,
    lineHeight: 1.5,
  },
  optionRow: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "flex-start",
  },
  optionMarker: {
    fontSize: 9,
    width: 18,
    color: "#64748b",
    flexShrink: 0,
  },
  optionMarkerCorrect: {
    fontSize: 9,
    width: 18,
    color: "#16a34a",
    fontFamily: "Helvetica-Bold",
    flexShrink: 0,
  },
  optionText: {
    fontSize: 9,
    color: "#374151",
    flex: 1,
  },
  optionTextCorrect: {
    fontSize: 9,
    color: "#16a34a",
    fontFamily: "Helvetica-Bold",
    flex: 1,
  },
  modelAnswerLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
  },
  modelAnswerBox: {
    backgroundColor: "#f1f5f9",
    borderRadius: 3,
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#94a3b8",
  },
  modelAnswerText: {
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.5,
  },
  activityImage: {
    maxWidth: 300,
    maxHeight: 200,
    objectFit: "contain",
    marginTop: 6,
    borderRadius: 3,
  },
  videoRow: {
    flexDirection: "row",
    gap: 16,
    alignItems: "flex-start",
    marginTop: 4,
  },
  videoThumbnail: {
    width: 160,
    height: 90,
    objectFit: "cover",
    borderRadius: 4,
  },
  qrBlock: {
    alignItems: "center",
  },
  qrImage: {
    width: 80,
    height: 80,
  },
  qrLabel: {
    fontSize: 7,
    color: "#94a3b8",
    marginTop: 3,
    textAlign: "center",
  },
  plainText: {
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.6,
  },
  // Key terms table
  termTable: {
    marginTop: 4,
  },
  termTableHeader: {
    flexDirection: "row",
    backgroundColor: "#1e293b",
    borderRadius: 3,
    marginBottom: 2,
  },
  termTableHeaderCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  termTableHeaderCellTerm: {
    width: "30%",
  },
  termTableHeaderCellDef: {
    width: "70%",
  },
  termRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  termRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#f1f5f9",
  },
  termCell: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    width: "30%",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  defCell: {
    fontSize: 9,
    color: "#374151",
    width: "70%",
    paddingVertical: 5,
    paddingHorizontal: 8,
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 42,
    right: 42,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: "#94a3b8",
  },
  answerBlock: {
    marginBottom: 14,
    padding: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  answerActivityTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 6,
  },
  answerActivityType: {
    fontSize: 7,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  answerCorrectLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#16a34a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  answerCorrectText: {
    fontSize: 9,
    color: "#16a34a",
    fontFamily: "Helvetica-Bold",
  },
})

// ---- Sub-components -------------------------------------------------------

function McqActivity({ activity }: { activity: PdfMcqActivity }) {
  return (
    <View style={styles.activityBlock} wrap={false}>
      <Text style={styles.activityTypeBadge}>Multiple Choice</Text>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Text style={styles.questionText}>{activity.question}</Text>
      {activity.imageDataUri ? (
        <Image src={activity.imageDataUri} style={styles.activityImage} />
      ) : null}
      <View>
        {activity.options.map((opt) => (
          <View key={opt.id} style={styles.optionRow}>
            <Text style={styles.optionMarker}>○</Text>
            <Text style={styles.optionText}>{opt.text}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function ShortTextActivity({ activity }: { activity: PdfShortTextActivity }) {
  return (
    <View style={styles.activityBlock} wrap={false}>
      <Text style={styles.activityTypeBadge}>Short Answer</Text>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Text style={styles.questionText}>{activity.question}</Text>
    </View>
  )
}

function ImageActivity({ activity }: { activity: PdfImageActivity }) {
  if (!activity.imageDataUri) return null
  return (
    <View style={styles.activityBlock} wrap={false}>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Image src={activity.imageDataUri} style={styles.activityImage} />
    </View>
  )
}

function VideoActivity({ activity }: { activity: PdfVideoActivity }) {
  return (
    <View style={styles.activityBlock} wrap={false}>
      <Text style={styles.activityTypeBadge}>Video</Text>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <View style={styles.videoRow}>
        {activity.thumbnailDataUri ? (
          <Image src={activity.thumbnailDataUri} style={styles.videoThumbnail} />
        ) : null}
        {activity.qrDataUri ? (
          <View style={styles.qrBlock}>
            <Image src={activity.qrDataUri} style={styles.qrImage} />
            <Text style={styles.qrLabel}>Scan to watch</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

function TextActivity({ activity }: { activity: PdfTextActivity }) {
  return (
    <View style={styles.activityBlock} wrap={false}>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Text style={styles.plainText}>{activity.content}</Text>
    </View>
  )
}

function KeyTermsActivity({ activity }: { activity: PdfKeyTermsActivity }) {
  if (activity.terms.length === 0) return null
  return (
    <View style={styles.activityBlock} wrap={false}>
      <Text style={styles.activityTypeBadge}>Key Terms</Text>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <View style={styles.termTable}>
        <View style={styles.termTableHeader}>
          <Text style={[styles.termTableHeaderCell, styles.termTableHeaderCellTerm]}>Term</Text>
          <Text style={[styles.termTableHeaderCell, styles.termTableHeaderCellDef]}>Definition</Text>
        </View>
        {activity.terms.map((row, index) => (
          <View key={index} style={index % 2 === 0 ? styles.termRow : styles.termRowAlt}>
            <Text style={styles.termCell}>{row.term}</Text>
            <Text style={styles.defCell}>{row.definition}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function OtherActivity({ activity }: { activity: PdfOtherActivity }) {
  return (
    <View style={styles.activityBlock} wrap={false}>
      <Text style={styles.activityTitle}>{activity.title}</Text>
    </View>
  )
}

// ---- Document -------------------------------------------------------------

export function LessonPlanDocument({
  unitTitle,
  lessonTitle,
  generatedAt,
  learningObjectives,
  activities,
}: LessonPlanDocumentProps) {
  const answerItems = activities.filter(
    (a): a is PdfMcqActivity | PdfShortTextActivity =>
      a.kind === "mcq" || a.kind === "short-text",
  )

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.unitLabel}>Unit</Text>
              <Text style={styles.unitTitle}>{unitTitle}</Text>
            </View>
            <Text style={styles.generatedDate}>{generatedAt}</Text>
          </View>
          <Text style={styles.lessonTitle}>{lessonTitle}</Text>
        </View>

        {learningObjectives.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Learning Objectives</Text>
            {learningObjectives.map((lo, index) => (
              <View key={lo.id} style={styles.loBlock} wrap={false}>
                <Text style={styles.loTitle}>
                  {index + 1}. {lo.title}
                </Text>
                {lo.criteria.map((sc) => (
                  <View key={sc.id} style={styles.scItem}>
                    <Text style={styles.scBullet}>•</Text>
                    <Text style={styles.scText}>{sc.description}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {activities.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Activities</Text>
            {activities.map((activity) => {
              switch (activity.kind) {
                case "mcq":
                  return <McqActivity key={activity.id} activity={activity} />
                case "short-text":
                  return <ShortTextActivity key={activity.id} activity={activity} />
                case "image":
                  return <ImageActivity key={activity.id} activity={activity} />
                case "video":
                  return <VideoActivity key={activity.id} activity={activity} />
                case "text":
                  return <TextActivity key={activity.id} activity={activity} />
                case "key-terms":
                  return <KeyTermsActivity key={activity.id} activity={activity} />
                case "other":
                  return <OtherActivity key={activity.id} activity={activity} />
              }
            })}
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{lessonTitle}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>

      {answerItems.length > 0 ? (
        <Page size="A4" style={styles.page}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.unitLabel}>Unit</Text>
                <Text style={styles.unitTitle}>{unitTitle}</Text>
              </View>
              <Text style={styles.generatedDate}>{generatedAt}</Text>
            </View>
            <Text style={styles.lessonTitle}>Answer Sheet</Text>
          </View>

          <View style={styles.section}>
            {answerItems.map((activity) => {
              if (activity.kind === "mcq") {
                const correct = activity.options.find((o) => o.id === activity.correctOptionId)
                return (
                  <View key={activity.id} style={styles.answerBlock} wrap={false}>
                    <Text style={styles.answerActivityType}>Multiple Choice</Text>
                    <Text style={styles.answerActivityTitle}>{activity.title}</Text>
                    <Text style={styles.answerCorrectLabel}>Correct Answer</Text>
                    <Text style={styles.answerCorrectText}>{correct?.text ?? "—"}</Text>
                  </View>
                )
              }
              return (
                <View key={activity.id} style={styles.answerBlock} wrap={false}>
                  <Text style={styles.answerActivityType}>Short Answer</Text>
                  <Text style={styles.answerActivityTitle}>{activity.title}</Text>
                  <Text style={styles.answerCorrectLabel}>Model Answer</Text>
                  <View style={styles.modelAnswerBox}>
                    <Text style={styles.modelAnswerText}>{activity.modelAnswer}</Text>
                  </View>
                </View>
              )
            })}
          </View>

          <View style={styles.footer} fixed>
            <Text style={styles.footerText}>{lessonTitle} — Answer Sheet</Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
            />
          </View>
        </Page>
      ) : null}
    </Document>
  )
}
