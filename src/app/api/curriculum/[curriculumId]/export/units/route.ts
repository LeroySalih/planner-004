import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
} from "docx"
import { NextRequest, NextResponse } from "next/server"

import { requireTeacherProfile } from "@/lib/auth"
import { stripLearningObjectiveFromDescription } from "@/lib/curriculum-formatting"
import { createExportBasename } from "@/lib/export-utils"
import { readCurriculumDetailAction } from "@/lib/server-actions/curricula"
import { readUnitsAction } from "@/lib/server-actions/units"

export const runtime = "nodejs"

type RouteParams = Promise<{ curriculumId: string }> | { curriculumId?: string }

type UnitAoGroup = {
  aoCode: string
  aoTitle: string
  levels: Map<number, Map<string, { loTitle: string; criteria: string[] }>>
}

type UnitSection = {
  unitId: string
  unitName: string
  year?: number
  subject?: string
  totalCriteria: number
  aoGroups: UnitAoGroup[]
}

export async function GET(_: NextRequest, context: { params: RouteParams }) {
  await requireTeacherProfile()

  const params = await Promise.resolve(context.params)
  const curriculumId = params.curriculumId?.trim() ?? ""

  if (!curriculumId) {
    return NextResponse.json({ error: "Curriculum id is required" }, { status: 400 })
  }

  const [curriculumResult, unitsResult] = await Promise.all([
    readCurriculumDetailAction(curriculumId),
    readUnitsAction(),
  ])

  if (curriculumResult.error) {
    return NextResponse.json({ error: curriculumResult.error }, { status: 500 })
  }

  if (unitsResult.error) {
    console.warn("[curricula] Failed to load units for export", unitsResult.error)
  }

  const curriculum = curriculumResult.data

  if (!curriculum) {
    return NextResponse.json({ error: "Curriculum not found" }, { status: 404 })
  }

  const units = (unitsResult.data ?? []).map((unit) => ({
    unit_id: unit.unit_id,
    title: unit.title,
    subject: unit.subject,
    description: unit.description,
    year: unit.year ?? deriveUnitYear(unit.title) ?? deriveUnitYear(unit.description ?? undefined),
  }))

  const unitSections = buildUnitSections(curriculum, units)
  const document = createDocument(curriculum.title, unitSections)
  const buffer = await Packer.toBuffer(document)
  const filename = `${createExportBasename(curriculum.title, curriculumId, { suffix: "units" })}.docx`
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const blob = new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": blob.size.toString(),
      "Cache-Control": "no-store",
    },
  })
}

type UnitMetadata = {
  unit_id: string
  title: string
  subject: string | null | undefined
  description: string | null | undefined
  year: number | null | undefined
}

function buildUnitSections(
  curriculum: NonNullable<Awaited<ReturnType<typeof readCurriculumDetailAction>>["data"]>,
  units: UnitMetadata[],
): UnitSection[] {
  const unitLookup = new Map(
    units.map((unit) => [
      unit.unit_id,
      {
        unitId: unit.unit_id,
        unitName: unit.title,
        year: unit.year ?? undefined,
        subject: unit.subject ?? undefined,
      },
    ]),
  )

  const unitMap = new Map<
    string,
    {
      unitId: string
      unitName: string
      year?: number
      subject?: string
      totalCriteria: number
      aoGroups: Map<string, UnitAoGroup>
    }
  >()

  const assessmentObjectives = (curriculum.assessment_objectives ?? [])
    .filter((ao): ao is NonNullable<typeof ao> => Boolean(ao))
    .slice()
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

  assessmentObjectives.forEach((ao, aoIndex) => {
    const aoCode = (ao.code ?? `AO${aoIndex + 1}`).trim()
    const aoTitle = (ao.title ?? "").trim()
    const aoKey = `${aoCode}__${aoTitle}`

    const learningObjectives = (ao.learning_objectives ?? [])
      .filter((lo): lo is NonNullable<typeof lo> => Boolean(lo) && lo.active !== false)
      .slice()
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

    learningObjectives.forEach((lo, loIndex) => {
      const loTitle = (lo.title ?? `Learning Objective ${loIndex + 1}`).trim()

      const successCriteria = (lo.success_criteria ?? [])
        .filter(
          (criterion): criterion is NonNullable<typeof criterion> =>
            Boolean(criterion) && criterion.active !== false,
        )
        .slice()
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

      successCriteria.forEach((criterion) => {
        const level = typeof criterion.level === "number" ? criterion.level : 1
        const cleanedDescription = stripLearningObjectiveFromDescription(criterion.description, loTitle).trim()

        if (cleanedDescription.length === 0) {
          return
        }

        const unitIds = Array.isArray(criterion.units) ? criterion.units : []

        unitIds.forEach((unitId) => {
          const meta =
            unitLookup.get(unitId) ?? {
              unitId,
              unitName: unitId,
              year: undefined,
              subject: curriculum.subject ?? undefined,
            }

          if (!unitMap.has(unitId)) {
            unitMap.set(unitId, {
              unitId,
              unitName: meta.unitName,
              year: meta.year,
              subject: meta.subject,
              totalCriteria: 0,
              aoGroups: new Map(),
            })
          }

          const unitEntry = unitMap.get(unitId)!
          unitEntry.totalCriteria += 1

          if (!unitEntry.aoGroups.has(aoKey)) {
            unitEntry.aoGroups.set(aoKey, {
              aoCode,
              aoTitle,
              levels: new Map(),
            })
          }

          const aoGroup = unitEntry.aoGroups.get(aoKey)!
          const levelBucket = aoGroup.levels.get(level) ?? new Map<string, { loTitle: string; criteria: string[] }>()

          if (!aoGroup.levels.has(level)) {
            aoGroup.levels.set(level, levelBucket)
          }

          const loBucket =
            levelBucket.get(loTitle) ??
            {
              loTitle,
              criteria: [],
            }

          if (!levelBucket.has(loTitle)) {
            levelBucket.set(loTitle, loBucket)
          }

          loBucket.criteria.push(cleanedDescription)
        })
      })
    })
  })

  const sections = Array.from(unitMap.values())
    .map((entry) => ({
      unitId: entry.unitId,
      unitName: entry.unitName,
      year: entry.year,
      subject: entry.subject,
      totalCriteria: entry.totalCriteria,
      aoGroups: Array.from(entry.aoGroups.values()).map((group) => ({
        aoCode: group.aoCode,
        aoTitle: group.aoTitle,
        levels: new Map(
          Array.from(group.levels.entries())
            .filter(([, loMap]) => Array.from(loMap.values()).some((lo) => lo.criteria.length > 0))
            .map(([level, loMap]) => {
              const orderedLo = new Map(
                Array.from(loMap.entries())
                  .map(([loTitle, payload]) => ({
                    loTitle,
                    criteria: payload.criteria.slice().sort((a, b) => a.localeCompare(b)),
                  }))
                  .sort((a, b) => a.loTitle.localeCompare(b.loTitle))
                  .map((item) => [item.loTitle, item] as const),
              )
              return [level, orderedLo] as const
            }),
        ),
      })),
    }))
    .filter((section) => section.totalCriteria > 0)

  sections.forEach((section) => {
    section.aoGroups.sort((a, b) => {
      if (a.aoCode && b.aoCode && a.aoCode !== b.aoCode) {
        return a.aoCode.localeCompare(b.aoCode)
      }
      if (a.aoTitle !== b.aoTitle) {
        return a.aoTitle.localeCompare(b.aoTitle)
      }
      return 0
    })

    section.aoGroups = section.aoGroups
      .map((group) => {
        const orderedLevels = new Map(
          Array.from(group.levels.entries()).sort(([levelA], [levelB]) => levelA - levelB),
        )
        return {
          ...group,
          levels: orderedLevels,
        }
      })
      .filter((group) => {
        return Array.from(group.levels.values()).some((level) =>
          Array.from(level.values()).some((lo) => lo.criteria.length > 0),
        )
      })
  })

  sections.sort((a, b) => {
    if (a.year !== undefined && b.year !== undefined && a.year !== b.year) {
      return a.year - b.year
    }
    return a.unitName.localeCompare(b.unitName)
  })

  return sections.map((section) => ({
    unitId: section.unitId,
    unitName: section.unitName,
    year: section.year,
    subject: section.subject,
    totalCriteria: section.totalCriteria,
    aoGroups: section.aoGroups,
  }))
}

function createDocument(title: string, sections: UnitSection[]) {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    }),
  ]

  if (sections.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No units associated with success criteria.",
            italics: true,
          }),
        ],
      }),
    )
  } else {
    sections.forEach((section, sectionIndex) => {
      children.push(createUnitHeading(section))
      children.push(createUnitMeta(section))

      if (section.aoGroups.length === 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "No assessment objectives linked to this unit.",
                italics: true,
              }),
            ],
          }),
        )
      } else {
        section.aoGroups.forEach((group, groupIndex) => {
          children.push(createAoHeading(group))
          const table = createAoTable(group)
          if (table) {
            children.push(table)
          } else {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "No success criteria available.",
                    italics: true,
                  }),
                ],
              }),
            )
          }

          if (groupIndex < section.aoGroups.length - 1) {
            children.push(
              new Paragraph({
                text: "",
                spacing: { after: 100 },
              }),
            )
          }
        })
      }

      if (sectionIndex < sections.length - 1) {
        children.push(
          new Paragraph({
            text: "",
            spacing: { after: 200 },
          }),
        )
      }
    })
  }

  return new Document({
    title: `${title} - Units Visualization`,
    description: "Units output exported from Planner",
    creator: "Planner",
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })
}

function createUnitHeading(section: UnitSection) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { after: 60 },
    children: [
      new TextRun({
        text: section.unitName,
        bold: true,
      }),
    ],
  })
}

function createUnitMeta(section: UnitSection) {
  const parts: string[] = []
  if (section.year !== undefined) {
    parts.push(`Year ${section.year}`)
  }
  if (section.subject) {
    parts.push(section.subject)
  }
  parts.push(`${section.totalCriteria} success criteria`)

  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: parts.join(" · "),
        color: "4B5563",
      }),
    ],
  })
}

function createAoHeading(group: UnitAoGroup) {
  const code = group.aoCode.trim()
  const title = group.aoTitle.trim()

  let content = ""
  if (code && title) {
    content = `${code} - ${title}`
  } else if (code) {
    content = code
  } else if (title) {
    content = title
  } else {
    content = "Assessment Objective"
  }

  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { after: 80 },
    children: [
      new TextRun({
        text: content,
        bold: true,
      }),
    ],
  })
}

function createAoTable(group: UnitAoGroup) {
  const rows: TableRow[] = []

  const levels = Array.from(group.levels.entries())
  if (levels.length === 0) {
    return null
  }

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      createHeaderCell("Level"),
      createHeaderCell("Learning Objective"),
      createHeaderCell("Success Criterion"),
    ],
  })

  rows.push(headerRow)

  levels.forEach(([level, loMap]) => {
    const loEntries = Array.from(loMap.values())
    const levelRowCount = loEntries.reduce((acc, lo) => acc + lo.criteria.length, 0)
    if (levelRowCount === 0) {
      return
    }

    let renderedRows = 0
    loEntries.forEach((lo) => {
      lo.criteria.forEach((criterion, index) => {
        const isFirstLevelRow = renderedRows === 0
        const isFirstLoRow = index === 0

        const cells: TableCell[] = []

        if (isFirstLevelRow) {
          cells.push(createLevelCell(level, levelRowCount))
        } else {
          cells.push(createLevelContinuationCell())
        }

        if (isFirstLoRow) {
          cells.push(createLearningObjectiveCell(lo.loTitle, lo.criteria.length))
        } else {
          cells.push(createLearningObjectiveContinuationCell())
        }

        cells.push(createCriterionCell(criterion))

        rows.push(
          new TableRow({
            cantSplit: true,
            children: cells,
          }),
        )

        renderedRows += 1
      })
    })
  })

  if (rows.length === 1) {
    return null
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [1000, 3500, 5500],
    borders: createTableBorders(),
    rows,
  })
}

function createHeaderCell(text: string) {
  return new TableCell({
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: true,
            color: "1F2937",
          }),
        ],
      }),
    ],
  })
}

function createLevelCell(level: number, rowSpan: number) {
  return new TableCell({
    verticalMerge: rowSpan > 1 ? VerticalMergeType.RESTART : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `Level ${level}`,
            bold: true,
            color: "047857",
          }),
        ],
      }),
    ],
  })
}

function createLevelContinuationCell() {
  return new TableCell({
    verticalMerge: VerticalMergeType.CONTINUE,
    children: [],
  })
}

function createLearningObjectiveCell(title: string, rowSpan: number) {
  return new TableCell({
    verticalMerge: rowSpan > 1 ? VerticalMergeType.RESTART : undefined,
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: title,
            bold: true,
          }),
        ],
      }),
    ],
  })
}

function createLearningObjectiveContinuationCell() {
  return new TableCell({
    verticalMerge: VerticalMergeType.CONTINUE,
    children: [],
  })
}

function createCriterionCell(text: string) {
  return new TableCell({
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
          }),
        ],
      }),
    ],
  })
}

function createTableBorders() {
  const outer = { style: BorderStyle.SINGLE, size: 8, color: "1F2937" }
  const inner = { style: BorderStyle.SINGLE, size: 4, color: "1F2937" }

  return {
    top: { ...outer },
    bottom: { ...outer },
    left: { ...outer },
    right: { ...outer },
    insideHorizontal: { ...inner },
    insideVertical: { ...inner },
  }
}

function deriveUnitYear(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const match = text.match(/(?:year|yr)\s*(\d{1,2})/i)
  if (!match) return undefined
  const parsed = Number.parseInt(match[1] ?? "", 10)
  return Number.isNaN(parsed) ? undefined : parsed
}
