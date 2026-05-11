// src/lib/docx/unit-report-document.ts
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  TableLayoutType,
  PageBreak,
} from "docx"

import type {
  UnitReportDocumentProps,
  UnitReportActivity,
  UnitReportLo,
  UnitReportLesson,
  UnitReportSc,
} from "@/components/pdf/unit-report-document"

// Re-export the types so consumers can import from one place
export type {
  UnitReportDocumentProps,
  UnitReportActivity,
  UnitReportLo,
  UnitReportLesson,
  UnitReportSc,
}

// ---- Colour constants (match PDF palette) ----------------------------------

const NAVY_HEX = "1a2744"
const LESSON_NAVY_HEX = "2d3f6b"
const SECTION_BG_HEX = "e8ecf4"
const BORDER_HEX = "cccccc"
const WHITE_HEX = "ffffff"
const LIGHT_BG_HEX = "f5f7fa"
const ASSESSMENT_BG_HEX = "fffbeb"

// ---- Helpers ----------------------------------------------------------------

function emptyPara(spacingAfter = 0) {
  return new Paragraph({ text: "", spacing: { after: spacingAfter } })
}

function navyHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({
    heading: level,
    children: [
      new TextRun({
        text,
        color: WHITE_HEX,
        bold: true,
      }),
    ],
    shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
    spacing: { before: 120, after: 0 },
  })
}

function lessonHeading(text: string, num: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({ text, color: WHITE_HEX, bold: true }),
      new TextRun({ text: `  ${num}`, color: "c0c8d8", size: 18 }),
    ],
    shading: { type: ShadingType.SOLID, color: LESSON_NAVY_HEX, fill: LESSON_NAVY_HEX },
    spacing: { before: 200, after: 0 },
  })
}

function subSectionHeading(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 16, color: NAVY_HEX })],
    shading: { type: ShadingType.SOLID, color: SECTION_BG_HEX, fill: SECTION_BG_HEX },
    spacing: { before: 80, after: 0 },
  })
}

function noBorder() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: "auto" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
  }
}

function thinBorder() {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
    left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
    right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
  }
}

// ---- LO / SC table ----------------------------------------------------------

function buildLoScTable(
  los: { spec_ref?: string | null; title: string; success_criteria: UnitReportSc[] }[],
) {
  if (los.length === 0) {
    return new Paragraph({
      children: [new TextRun({ text: "No learning objectives defined.", color: "999999", size: 18 })],
      spacing: { after: 80 },
    })
  }

  const rows = los.map((lo, i) => {
    const sorted = [...lo.success_criteria].sort(
      (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
    )
    const scChildren = sorted.flatMap((sc, j) => {
      const parts: TextRun[] = []
      if (sc.level != null) {
        parts.push(new TextRun({ text: `L${sc.level} `, bold: true, color: NAVY_HEX, size: 16 }))
      }
      parts.push(new TextRun({ text: sc.description, size: 16 }))
      if (j < sorted.length - 1) parts.push(new TextRun({ text: "\n", size: 16 }))
      return parts
    })

    return new TableRow({
      children: [
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          borders: thinBorder(),
          shading: i % 2 === 0
            ? { type: ShadingType.SOLID, color: LIGHT_BG_HEX, fill: LIGHT_BG_HEX }
            : undefined,
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: lo.spec_ref ?? "LO", bold: true, color: NAVY_HEX, size: 16 }),
                new TextRun({ text: "\n" + lo.title, size: 16, color: "555555" }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          borders: thinBorder(),
          children: [
            new Paragraph({
              children:
                scChildren.length > 0
                  ? scChildren
                  : [new TextRun({ text: "No success criteria", size: 16, color: "999999" })],
            }),
          ],
        }),
      ],
    })
  })

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  })
}

// ---- Key terms table --------------------------------------------------------

function buildKeyTermsTable(terms: { term: string; definition: string }[]) {
  if (terms.length === 0) return null

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        borders: thinBorder(),
        shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
        children: [
          new Paragraph({
            children: [new TextRun({ text: "Term", bold: true, color: WHITE_HEX, size: 16 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        borders: thinBorder(),
        shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
        children: [
          new Paragraph({
            children: [new TextRun({ text: "Definition", bold: true, color: WHITE_HEX, size: 16 })],
          }),
        ],
      }),
    ],
  })

  const dataRows = terms.map((row) =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          borders: thinBorder(),
          children: [
            new Paragraph({
              children: [new TextRun({ text: row.term, bold: true, size: 16 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          borders: thinBorder(),
          children: [
            new Paragraph({
              children: [new TextRun({ text: row.definition, size: 16 })],
            }),
          ],
        }),
      ],
    }),
  )

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  })
}

// ---- Activity block ---------------------------------------------------------

function buildActivityBlock(activity: UnitReportActivity): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = []

  // Title row
  const titleChildren: TextRun[] = [
    new TextRun({
      text: activity.title || "Untitled activity",
      bold: activity.isScorable,
      size: 18,
      color: activity.isScorable ? "b45309" : "333333",
    }),
  ]
  if (activity.isScorable) {
    titleChildren.push(new TextRun({ text: "  [ASSESSMENT]", bold: true, size: 16, color: "b45309" }))
  }

  blocks.push(
    new Paragraph({
      children: titleChildren,
      shading: activity.isScorable
        ? { type: ShadingType.SOLID, color: ASSESSMENT_BG_HEX, fill: ASSESSMENT_BG_HEX }
        : undefined,
      spacing: { before: 60, after: 40 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "eeeeee" },
      },
    }),
  )

  // Key terms table
  if (activity.keyTerms && activity.keyTerms.length > 0) {
    const kt = buildKeyTermsTable(activity.keyTerms)
    if (kt) blocks.push(kt)
    blocks.push(emptyPara(60))
  }

  // Flashcard content
  if (activity.flashcard) {
    blocks.push(
      new Paragraph({
        children: [new TextRun({ text: activity.flashcard.title, bold: true, size: 18, color: NAVY_HEX })],
        shading: { type: ShadingType.SOLID, color: "f9fafb", fill: "f9fafb" },
        spacing: { before: 40, after: 20 },
        border: thinBorder(),
      }),
      new Paragraph({
        children: [new TextRun({ text: activity.flashcard.lines, size: 16, color: "444444" })],
        shading: { type: ShadingType.SOLID, color: "f9fafb", fill: "f9fafb" },
        spacing: { after: 60 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "d1d5db" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "d1d5db" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "d1d5db" },
        },
      }),
    )
  }

  return blocks
}

// ---- Lesson block -----------------------------------------------------------

function buildLessonBlock(lesson: UnitReportLesson, idx: number, total: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = []

  const sortedObjectives = [...lesson.lesson_objectives].sort(
    (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
  )

  blocks.push(lessonHeading(lesson.title, `Lesson ${idx + 1} of ${total}`))

  // Learning Objectives & Success Criteria
  blocks.push(subSectionHeading("Learning Objectives & Success Criteria"))

  const loRows = sortedObjectives.map((lo) => {
    const matchingScs = lesson.lesson_success_criteria.filter(
      (sc) => sc.learning_objective_id === lo.learning_objective_id,
    )
    return {
      spec_ref: lo.spec_ref ?? null,
      title: lo.title,
      success_criteria: matchingScs,
    }
  })
  blocks.push(buildLoScTable(loRows))

  // Resources
  const hasFiles = lesson.file_names.length > 0 || lesson.lesson_links.length > 0
  if (hasFiles) {
    blocks.push(subSectionHeading("Resources"))
    for (const name of lesson.file_names) {
      blocks.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${name}`, size: 18, color: "224488" })],
          spacing: { after: 40 },
        }),
      )
    }
    for (const link of lesson.lesson_links) {
      blocks.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${link.description ?? link.url}`, size: 18, color: "224488" })],
          spacing: { after: 40 },
        }),
      )
    }
  }

  // Activities
  if (lesson.activities.length > 0) {
    blocks.push(subSectionHeading("Activities"))
    for (const activity of lesson.activities) {
      blocks.push(...buildActivityBlock(activity))
    }
  }

  return blocks
}

// ---- Main builder -----------------------------------------------------------

export async function buildUnitReportDocx(props: UnitReportDocumentProps): Promise<Buffer> {
  const {
    unitTitle,
    subject,
    year,
    description,
    learningObjectives,
    lessons,
  } = props

  const infoText = [subject, year != null ? `Year ${year}` : null]
    .filter(Boolean)
    .join(" · ")

  const sortedLessons = [...lessons].sort(
    (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
  )

  // Group LOs by assessment objective
  const aoMap = new Map<
    string,
    { code: string | null; title: string | null; order: number | null; los: UnitReportLo[] }
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
  const aoGroups = [...aoMap.entries()].sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))

  // ---- Overview section children -----------------------------------------

  const overviewChildren: (Paragraph | Table)[] = [
    // Title block
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: unitTitle, color: WHITE_HEX, bold: true, size: 36 })],
      shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
      spacing: { before: 0, after: 0 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Unit Report", color: "c0c8d8", size: 22 })],
      shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
      spacing: { before: 0, after: 0 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Unit Overview", color: "888888", size: 18 })],
      spacing: { before: 60, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: infoText, color: WHITE_HEX, size: 18 })],
      shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
      spacing: { before: 0, after: 120 },
    }),

    // Unit Description
    navyHeading("Unit Description", HeadingLevel.HEADING_2),
    new Paragraph({
      children: [
        new TextRun({
          text: description?.trim() || "No description provided.",
          size: 20,
          color: "444444",
        }),
      ],
      border: thinBorder(),
      spacing: { before: 0, after: 120 },
    }),

    // Learning Objectives & Success Criteria
    navyHeading("Learning Objectives & Success Criteria", HeadingLevel.HEADING_2),
    emptyPara(40),
  ]

  for (const [, ao] of aoGroups) {
    const sortedLos = [...ao.los].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    if (ao.code || ao.title) {
      overviewChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: ao.code ?? "AO", bold: true, color: NAVY_HEX, size: 18 }),
            ao.title ? new TextRun({ text: `  ${ao.title}`, size: 18, color: "555555" }) : new TextRun(""),
          ],
          shading: { type: ShadingType.SOLID, color: "eef1f8", fill: "eef1f8" },
          border: thinBorder(),
          spacing: { before: 60, after: 0 },
        }),
      )
    }
    overviewChildren.push(
      buildLoScTable(
        sortedLos.map((lo) => ({
          spec_ref: lo.spec_ref ?? null,
          title: lo.title,
          success_criteria: lo.success_criteria,
        })),
      ),
    )
    overviewChildren.push(emptyPara(40))
  }

  if (learningObjectives.length === 0) {
    overviewChildren.push(
      new Paragraph({
        children: [new TextRun({ text: "No learning objectives defined for this unit.", size: 18, color: "999999" })],
        spacing: { after: 80 },
      }),
    )
  }

  // Key Terms index
  const ktLessons = sortedLessons.filter((l) => l.activities.some((a) => a.type === "display-key-terms"))
  if (ktLessons.length > 0) {
    overviewChildren.push(navyHeading("Key Terms", HeadingLevel.HEADING_2), emptyPara(40))
    for (const l of ktLessons) {
      overviewChildren.push(
        new Paragraph({
          children: [new TextRun({ text: l.title, size: 18 })],
          border: thinBorder(),
          spacing: { before: 0, after: 0 },
        }),
      )
    }
    overviewChildren.push(emptyPara(80))
  }

  // Flashcards index
  const fcLessons = sortedLessons.filter((l) => l.activities.some((a) => a.type === "do-flashcards"))
  if (fcLessons.length > 0) {
    overviewChildren.push(navyHeading("Flashcards", HeadingLevel.HEADING_2), emptyPara(40))
    for (const l of fcLessons) {
      overviewChildren.push(
        new Paragraph({
          children: [new TextRun({ text: l.title, size: 18 })],
          border: thinBorder(),
          spacing: { before: 0, after: 0 },
        }),
      )
    }
    overviewChildren.push(emptyPara(80))
  }

  // ---- Lessons section children ------------------------------------------

  const lessonsChildren: (Paragraph | Table)[] = [
    // Page header
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: unitTitle, color: WHITE_HEX, bold: true, size: 36 })],
      shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
      spacing: { before: 0, after: 0 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Unit Report", color: "c0c8d8", size: 22 })],
      shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
      spacing: { before: 0, after: 0 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Lessons", color: "888888", size: 18 })],
      spacing: { before: 60, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: infoText, color: WHITE_HEX, size: 18 })],
      shading: { type: ShadingType.SOLID, color: NAVY_HEX, fill: NAVY_HEX },
      spacing: { before: 0, after: 120 },
    }),
  ]

  if (sortedLessons.length === 0) {
    lessonsChildren.push(
      new Paragraph({
        children: [new TextRun({ text: "No lessons in this unit.", size: 18, color: "999999" })],
      }),
    )
  } else {
    for (const [i, lesson] of sortedLessons.entries()) {
      lessonsChildren.push(...buildLessonBlock(lesson, i, sortedLessons.length))
    }
  }

  // ---- Assemble document --------------------------------------------------

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 20 },
        },
      },
    },
    sections: [
      {
        children: overviewChildren,
      },
      {
        children: [
          new Paragraph({ children: [new PageBreak()] }),
          ...lessonsChildren,
        ],
      },
    ],
  })

  return Packer.toBuffer(doc)
}
