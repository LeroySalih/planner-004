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

export const runtime = "nodejs"

type RouteParams = Promise<{ curriculumId: string }> | { curriculumId?: string }

const levelOrder = [1, 2, 3, 4, 5, 6, 7]

type LevelSection = {
  level: number
  aoGroups: LevelAoGroup[]
}

type LevelAoGroup = {
  aoCode: string
  aoTitle: string
  aoOrder: number
  criteria: string[]
}

type LevelAoAccumulator = LevelAoGroup & { criteriaSet: Set<string> }

export async function GET(_: NextRequest, context: { params: RouteParams }) {
  await requireTeacherProfile()

  const params = await Promise.resolve(context.params)
  const curriculumId = params.curriculumId?.trim() ?? ""

  if (!curriculumId) {
    return NextResponse.json({ error: "Curriculum id is required" }, { status: 400 })
  }

  const result = await readCurriculumDetailAction(curriculumId)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  const curriculum = result.data

  if (!curriculum) {
    return NextResponse.json({ error: "Curriculum not found" }, { status: 404 })
  }

  const sections = buildLevelSections(curriculum)

  const document = createDocument(curriculum.title, sections)
  const buffer = await Packer.toBuffer(document)
  const filename = `${createExportBasename(curriculum.title, curriculumId, { suffix: "levels" })}.docx`
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

function buildLevelSections(curriculum: Awaited<ReturnType<typeof readCurriculumDetailAction>>["data"]): LevelSection[] {
  if (!curriculum) {
    return []
  }

  const allowedLevels = new Set(levelOrder)
  const levelMap = new Map<number, Map<string, LevelAoAccumulator>>()

  const assessmentObjectives = (curriculum.assessment_objectives ?? [])
    .filter((ao): ao is NonNullable<typeof ao> => Boolean(ao))
    .slice()
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

  assessmentObjectives.forEach((ao, aoIndex) => {
    const aoCode = ao.code?.trim() ?? `AO${aoIndex + 1}`
    const aoTitle = ao.title?.trim() ?? ""
    const aoOrder = ao.order_index ?? Number.MAX_SAFE_INTEGER
    const aoKey = ao.assessment_objective_id ?? `${aoCode}-${aoTitle}`

    const learningObjectives = (ao.learning_objectives ?? [])
      .filter((lo): lo is NonNullable<typeof lo> => Boolean(lo) && lo.active !== false)
      .slice()
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

    learningObjectives.forEach((lo) => {
      const loTitle = lo.title ?? ""

      const successCriteria = (lo.success_criteria ?? [])
        .filter((criterion): criterion is NonNullable<typeof criterion> => Boolean(criterion) && criterion.active !== false)
        .slice()
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

      successCriteria.forEach((criterion) => {
        const levelValue = criterion.level
        if (typeof levelValue !== "number" || !allowedLevels.has(levelValue)) {
          return
        }

        const cleaned = stripLearningObjectiveFromDescription(criterion.description, loTitle).trim()
        if (cleaned.length === 0) {
          return
        }

        const levelBucket = getOrCreateLevelBucket(levelMap, levelValue)
        const aoBucket = getOrCreateAoBucket(levelBucket, aoKey, {
          aoCode,
          aoTitle,
          aoOrder,
        })

        if (!aoBucket.criteriaSet.has(cleaned)) {
          aoBucket.criteriaSet.add(cleaned)
          aoBucket.criteria.push(cleaned)
        }
      })
    })
  })

  const sections = Array.from(levelMap.entries())
    .map(([level, aoMap]) => ({
      level,
      aoGroups: Array.from(aoMap.values()).map((group) => ({
        aoCode: group.aoCode,
        aoTitle: group.aoTitle,
        aoOrder: group.aoOrder,
        criteria: group.criteria.slice(),
      })),
    }))
    .filter((section) => section.aoGroups.some((ao) => ao.criteria.length > 0))
    .sort((a, b) => b.level - a.level)

  sections.forEach((section) => {
    section.aoGroups.sort((a, b) => {
      if (a.aoOrder !== b.aoOrder) {
        return a.aoOrder - b.aoOrder
      }
      const codeComparison = a.aoCode.localeCompare(b.aoCode)
      if (codeComparison !== 0) {
        return codeComparison
      }
      return a.aoTitle.localeCompare(b.aoTitle)
    })
  })

  return sections
}

function getOrCreateLevelBucket(
  map: Map<number, Map<string, LevelAoAccumulator>>,
  level: number,
): Map<string, LevelAoAccumulator> {
  if (!map.has(level)) {
    map.set(level, new Map())
  }
  return map.get(level)!
}

function getOrCreateAoBucket(
  map: Map<string, LevelAoAccumulator>,
  aoKey: string,
  meta: Pick<LevelAoGroup, "aoCode" | "aoTitle" | "aoOrder">,
): LevelAoAccumulator {
  if (!map.has(aoKey)) {
    map.set(aoKey, {
      aoCode: meta.aoCode,
      aoTitle: meta.aoTitle,
      aoOrder: meta.aoOrder,
      criteria: [],
      criteriaSet: new Set<string>(),
    })
  }
  return map.get(aoKey)!
}

function createDocument(title: string, sections: LevelSection[]) {
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
            text: "No success criteria available.",
            italics: true,
          }),
        ],
      }),
    )
  } else {
    sections.forEach((section, index) => {
      children.push(createLevelTable(section))
      if (index < sections.length - 1) {
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
    title: `${title} - Levels Visualization`,
    description: "Levels output exported from Planner",
    creator: "Planner",
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })
}

function createLevelTable(section: LevelSection) {
  const rows = section.aoGroups.map((group, index) => {
    const levelCell = index === 0 ? createLevelNumberCell(section.level) : createLevelMergeCell()
    return new TableRow({
      cantSplit: true,
      children: [levelCell, createAoCell(group)],
    })
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [1200, 7800],
    borders: createTableBorders(),
    rows,
  })
}

function createLevelNumberCell(level: number) {
  return new TableCell({
    verticalMerge: VerticalMergeType.RESTART,
    verticalAlign: VerticalAlign.CENTER,
    width: { size: 1200, type: WidthType.DXA },
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: String(level),
            bold: true,
            size: 48,
            color: "1D4ED8",
          }),
        ],
      }),
    ],
  })
}

function createLevelMergeCell() {
  return new TableCell({
    verticalMerge: VerticalMergeType.CONTINUE,
    children: [],
  })
}

function createAoCell(group: LevelAoGroup) {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: formatAoHeading(group),
          bold: true,
        }),
      ],
    }),
  ]

  group.criteria.forEach((criterion) => {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 60 },
        bullet: { level: 0 },
        children: [
          new TextRun({
            text: criterion,
          }),
        ],
      }),
    )
  })

  if (group.criteria.length === 0) {
    paragraphs.push(
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

  return new TableCell({
    margins: { top: 180, bottom: 180, left: 240, right: 240 },
    children: paragraphs,
  })
}

function formatAoHeading(group: LevelAoGroup) {
  const code = group.aoCode.trim()
  const title = group.aoTitle.trim()

  if (code && title) {
    return `${code} - ${title}`
  }

  return code || title || "Assessment objective"
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
