// src/components/pdf/unit-report-document.tsx
import { Document, Image, Page, StyleSheet, Text, View, Link } from "@react-pdf/renderer"

// ---- Types ----------------------------------------------------------------

export interface UnitReportSc {
  success_criteria_id: string
  description: string
  level: number | null
  order_index: number | null
  learning_objective_id?: string
}

export interface UnitReportActivity {
  activity_id: string
  title: string
  type: string
  isScorable: boolean
  imageDataUri: string | null
}

export interface UnitReportLo {
  learning_objective_id: string
  title: string
  order_index: number | null
  spec_ref: string | null
  assessment_objective_id: string | null
  assessment_objective_code: string | null
  assessment_objective_title: string | null
  assessment_objective_order_index: number | null
  success_criteria: UnitReportSc[]
}

export interface UnitReportLesson {
  lesson_id: string
  title: string
  order_by: number | null
  lesson_objectives: {
    learning_objective_id: string
    title: string
    order_by: number | null
    spec_ref?: string | null
  }[]
  lesson_success_criteria: UnitReportSc[]
  lesson_links: { url: string; description: string | null }[]
  file_names: string[]
  activities: UnitReportActivity[]
}

export interface UnitReportDocumentProps {
  unitTitle: string
  subject: string
  year: number | null
  description: string | null
  learningObjectives: UnitReportLo[]
  lessons: UnitReportLesson[]
}

// ---- Styles ---------------------------------------------------------------

const NAVY = "#1a2744"
const LESSON_NAVY = "#2d3f6b"
const BORDER = "#cccccc"

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#222222",
    backgroundColor: "#ffffff",
    paddingTop: 0,
    paddingBottom: 36,
    paddingLeft: 0,
    paddingRight: 0,
  },
  header: {
    backgroundColor: NAVY,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleBlock: {
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#c0c8d8",
    textAlign: "center",
    marginTop: 2,
  },
  pageSubtitle: {
    textAlign: "center",
    fontSize: 10,
    color: "#888888",
    paddingVertical: 6,
  },
  infoBar: {
    backgroundColor: NAVY,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginHorizontal: 12,
  },
  infoBarText: {
    fontSize: 9,
    color: "#ffffff",
  },
  sectionHeader: {
    backgroundColor: NAVY,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 10,
    marginHorizontal: 12,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  descBox: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 10,
    lineHeight: 1.5,
    color: "#444444",
  },
  table: {
    marginHorizontal: 12,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER,
  },
  tableRowFirst: {
    borderTopWidth: 1,
  },
  colLeft: {
    width: "30%",
    padding: 6,
    borderRightWidth: 2,
    borderRightColor: NAVY,
  },
  colRight: {
    width: "70%",
    padding: 6,
  },
  colFull: {
    width: "100%",
    padding: 6,
    backgroundColor: "#f5f7fa",
  },
  aoHeader: {
    backgroundColor: "#eef1f8",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
  },
  aoCode: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginRight: 6,
  },
  aoTitle: {
    fontSize: 9,
    color: "#555555",
  },
  loRef: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginBottom: 2,
  },
  loTitle: {
    fontSize: 9,
    color: "#555555",
  },
  scRow: {
    flexDirection: "row",
    marginBottom: 2,
    alignItems: "flex-start",
  },
  levelBadge: {
    backgroundColor: NAVY,
    color: "#ffffff",
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    marginRight: 4,
    marginTop: 1,
  },
  scText: {
    fontSize: 9,
    color: "#333333",
    flex: 1,
    lineHeight: 1.4,
  },
  lessonBar: {
    backgroundColor: LESSON_NAVY,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginTop: 8,
    marginHorizontal: 12,
  },
  lessonBarTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  lessonBarNum: {
    fontSize: 9,
    color: "#c0c8d8",
  },
  filesLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#666666",
    marginBottom: 3,
  },
  fileRow: {
    fontSize: 9,
    color: "#224488",
    marginBottom: 2,
  },
  footer: {
    position: "absolute",
    bottom: 14,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 9,
    color: "#888888",
  },
  noContent: {
    fontSize: 9,
    color: "#999999",
    padding: 6,
  },
})

// ---- Sub-components -------------------------------------------------------

function ScList({ criteria }: { criteria: UnitReportSc[] }) {
  if (criteria.length === 0) return <Text style={s.noContent}>No success criteria</Text>
  const sorted = [...criteria].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
  return (
    <>
      {sorted.map((sc) => (
        <View key={sc.success_criteria_id} style={s.scRow}>
          {sc.level != null && (
            <Text style={s.levelBadge}>L{sc.level}</Text>
          )}
          <Text style={s.scText}>{sc.description}</Text>
        </View>
      ))}
    </>
  )
}

function FilesSection({
  fileNames,
  links,
}: {
  fileNames: string[]
  links: { url: string; description: string | null }[]
}) {
  if (fileNames.length === 0 && links.length === 0) return null
  return (
    <View style={[s.tableRow, { borderTopWidth: 0 }]}>
      <View style={s.colFull}>
        <Text style={s.filesLabel}>DOWNLOADABLE FILES</Text>
        {fileNames.map((name, i) => (
          <Text key={`f-${i}`} style={s.fileRow}>{name}</Text>
        ))}
        {links.map((link, i) => (
          <Link key={`l-${i}`} src={link.url}>
            <Text style={s.fileRow}>{link.description ?? link.url}</Text>
          </Link>
        ))}
      </View>
    </View>
  )
}

const ASSESSMENT_AMBER = "#b45309"
const ASSESSMENT_BG = "#fffbeb"
const ASSESSMENT_BORDER = "#fcd34d"

function ActivitiesSection({ activities }: { activities: UnitReportActivity[] }) {
  if (activities.length === 0) return null
  return (
    <View style={[s.tableRow, { borderTopWidth: 0, flexDirection: "column", padding: 0 }]}>
      {activities.map((activity) => (
        <View
          key={activity.activity_id}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderBottomWidth: 1,
            borderBottomColor: "#eeeeee",
            backgroundColor: activity.isScorable ? ASSESSMENT_BG : "#ffffff",
          }}
        >
          {/* Thumbnail for display-image */}
          {activity.type === "display-image" && (
            <View style={{ marginRight: 6, flexShrink: 0 }}>
              {activity.imageDataUri ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image
                  src={activity.imageDataUri}
                  style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 2 }}
                />
              ) : (
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 2,
                    borderWidth: 1,
                    borderColor: BORDER,
                    backgroundColor: "#f5f7fa",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 6, color: "#aaaaaa", textAlign: "center" }}>
                    No{"\n"}image
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Activity title */}
          <Text style={{ fontSize: 9, color: "#333333", flex: 1, marginTop: 2 }}>
            {activity.title || "Untitled activity"}
          </Text>

          {/* Assessment badge */}
          {activity.isScorable && (
            <Text
              style={{
                fontSize: 7,
                fontFamily: "Helvetica-Bold",
                color: ASSESSMENT_AMBER,
                borderWidth: 1,
                borderColor: ASSESSMENT_BORDER,
                backgroundColor: ASSESSMENT_BG,
                paddingHorizontal: 4,
                paddingVertical: 2,
                borderRadius: 3,
                marginLeft: 6,
                flexShrink: 0,
              }}
            >
              ASSESSMENT
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

// ---- Shared page header ---------------------------------------------------

function PageHeader({ unitTitle, infoText, pageSubtitle }: { unitTitle: string; infoText: string; pageSubtitle: string }) {
  return (
    <>
      <View style={s.header}>
        <View style={s.headerTitleBlock}>
          <Text style={s.headerTitle}>{unitTitle}</Text>
          <Text style={s.headerSubtitle}>Unit Report</Text>
        </View>
      </View>
      <Text style={s.pageSubtitle}>{pageSubtitle}</Text>
      <View style={s.infoBar}>
        <Text style={s.infoBarText}>{infoText}</Text>
      </View>
    </>
  )
}

// ---- Main document --------------------------------------------------------

export function UnitReportDocument({
  unitTitle,
  subject,
  year,
  description,
  learningObjectives,
  lessons,
}: UnitReportDocumentProps) {
  // Group LOs by assessment objective
  const aoMap = new Map<
    string,
    {
      code: string | null
      title: string | null
      order: number | null
      los: UnitReportLo[]
    }
  >()

  for (const lo of learningObjectives) {
    const aoId = lo.assessment_objective_id ?? "__none__"
    if (!aoMap.has(aoId)) {
      aoMap.set(aoId, {
        code: lo.assessment_objective_code,
        title: lo.assessment_objective_title,
        order: lo.assessment_objective_order_index,
        los: [],
      })
    }
    aoMap.get(aoId)!.los.push(lo)
  }

  const aoGroups = [...aoMap.entries()].sort(
    ([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0),
  )

  const infoText = [subject, year != null ? `Year ${year}` : null]
    .filter(Boolean)
    .join(" · ")

  const sortedLessons = [...lessons].sort(
    (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
  )

  return (
    <Document>
      {/* ---- Page 1: Overview ----------------------------------------- */}
      <Page size="A4" style={s.page}>
        <PageHeader unitTitle={unitTitle} infoText={infoText} pageSubtitle="Unit Overview" />

        {/* Section: Description */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionHeaderText}>Unit Description</Text>
        </View>
        <View style={s.descBox}>
          <Text>{description?.trim() || "No description provided."}</Text>
        </View>

        {/* Section: LOs & SCs */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionHeaderText}>Learning Objectives & Success Criteria</Text>
        </View>

        <View style={s.table}>
          {aoGroups.map(([aoId, ao], aoIdx) => {
            const sortedLos = [...ao.los].sort(
              (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
            )
            return (
              <View key={aoId}>
                <View
                  style={[
                    s.aoHeader,
                    aoIdx === 0 ? { borderTopWidth: 1 } : {},
                  ]}
                >
                  <Text style={s.aoCode}>{ao.code ?? "AO"}</Text>
                  {ao.title && <Text style={s.aoTitle}>{ao.title}</Text>}
                </View>

                {sortedLos.map((lo) => (
                  <View key={lo.learning_objective_id} style={s.tableRow}>
                    <View style={s.colLeft}>
                      <Text style={s.loRef}>
                        {lo.spec_ref ?? `LO ${(lo.order_index ?? 0) + 1}`}
                      </Text>
                      <Text style={s.loTitle}>{lo.title}</Text>
                    </View>
                    <View style={s.colRight}>
                      <ScList criteria={lo.success_criteria} />
                    </View>
                  </View>
                ))}
              </View>
            )
          })}

          {learningObjectives.length === 0 && (
            <View style={[s.tableRow, s.tableRowFirst]}>
              <View style={s.colFull}>
                <Text style={s.noContent}>No learning objectives defined for this unit.</Text>
              </View>
            </View>
          )}
        </View>

        <Text
          style={s.footer}
          render={({ pageNumber }) => `Page ${pageNumber}`}
          fixed
        />
      </Page>

      {/* ---- Page 2+: Lessons ----------------------------------------- */}
      <Page size="A4" style={s.page}>
        <PageHeader unitTitle={unitTitle} infoText={infoText} pageSubtitle="Lessons" />

        {sortedLessons.length === 0 && (
          <View style={{ marginHorizontal: 12, marginTop: 10 }}>
            <Text style={s.noContent}>No lessons in this unit.</Text>
          </View>
        )}

        {sortedLessons.map((lesson, idx) => {
          const sortedObjectives = [...lesson.lesson_objectives].sort(
            (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
          )
          const hasFiles =
            lesson.file_names.length > 0 || lesson.lesson_links.length > 0

          return (
            <View key={lesson.lesson_id}>
              <View style={s.lessonBar}>
                <Text style={s.lessonBarTitle}>{lesson.title}</Text>
                <Text style={s.lessonBarNum}>
                  Lesson {idx + 1} of {sortedLessons.length}
                </Text>
              </View>

              <View style={s.table}>
                {sortedObjectives.length === 0 && (
                  <View style={[s.tableRow, s.tableRowFirst]}>
                    <View style={s.colFull}>
                      <Text style={s.noContent}>No objectives assigned to this lesson.</Text>
                    </View>
                  </View>
                )}
                {sortedObjectives.map((lo, loIdx) => {
                  const matchingScs = lesson.lesson_success_criteria.filter(
                    (sc) => sc.learning_objective_id === lo.learning_objective_id,
                  )
                  const displayScs =
                    matchingScs.length > 0 ? matchingScs : []

                  return (
                    <View
                      key={lo.learning_objective_id}
                      style={[s.tableRow, loIdx === 0 ? s.tableRowFirst : {}]}
                    >
                      <View style={s.colLeft}>
                        <Text style={s.loRef}>
                          {lo.spec_ref ?? "—"}
                        </Text>
                        <Text style={s.loTitle}>{lo.title}</Text>
                      </View>
                      <View style={s.colRight}>
                        <ScList criteria={displayScs} />
                      </View>
                    </View>
                  )
                })}

                {hasFiles && (
                  <FilesSection
                    fileNames={lesson.file_names}
                    links={lesson.lesson_links}
                  />
                )}
                {lesson.activities.length > 0 && (
                  <View style={[s.tableRow, { borderTopWidth: 0 }]}>
                    <View style={[s.colFull, { paddingBottom: 0 }]}>
                      <Text style={s.filesLabel}>ACTIVITIES</Text>
                    </View>
                  </View>
                )}
                <ActivitiesSection activities={lesson.activities} />
              </View>
            </View>
          )
        })}

        <Text
          style={s.footer}
          render={({ pageNumber }) => `Page ${pageNumber}`}
          fixed
        />
      </Page>
    </Document>
  )
}
