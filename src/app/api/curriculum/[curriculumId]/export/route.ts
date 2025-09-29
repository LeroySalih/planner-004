import ExcelJS from "exceljs"
import { NextRequest, NextResponse } from "next/server"

import { requireTeacherProfile } from "@/lib/auth"
import { readCurriculumDetailAction } from "@/lib/server-actions/curricula"

export const runtime = "nodejs"

type RouteParams = Promise<{ curriculumId: string }> | { curriculumId?: string }

export async function GET(_: NextRequest, context: { params: RouteParams }) {
  await requireTeacherProfile()

  const params = await Promise.resolve(context.params)
  const curriculumId = params.curriculumId?.trim()

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

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet("Curriculum")

  worksheet.addRow(["Name of the curriculum", curriculum.title])
  worksheet.addRow(["Subject", curriculum.subject ?? "Not assigned"])
  worksheet.addRow(["Description", curriculum.description ?? ""])
  worksheet.addRow([])

  const headerRow = worksheet.addRow(["Level", "Assessment Objective", "Learning Objective", "Success Criterion"])
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: "middle" }
  worksheet.getColumn(1).width = 12
  worksheet.getColumn(2).width = 42
  worksheet.getColumn(3).width = 42
  worksheet.getColumn(4).width = 64

  const assessmentObjectives = curriculum.assessment_objectives ?? []

  type ExportRow = {
    level: number | null
    levelDisplay: string
    assessmentObjectiveId: string
    assessmentObjectiveLabel: string
    assessmentObjectiveSort: string
    assessmentObjectiveOrder: number | null
    learningObjectiveId: string
    learningObjectiveTitle: string
    learningObjectiveSort: string
    learningObjectiveOrder: number | null
    successCriterion: string | null
    successCriterionSort: string
    successCriterionOrder: number | null
  }

  const rows: ExportRow[] = []

  if (assessmentObjectives.length === 0) {
    rows.push({
      level: null,
      levelDisplay: "",
      assessmentObjectiveId: "no-ao",
      assessmentObjectiveLabel: "No assessment objectives",
      assessmentObjectiveSort: "zzzz",
      assessmentObjectiveOrder: null,
      learningObjectiveId: "no-lo",
      learningObjectiveTitle: "",
      learningObjectiveSort: "",
      learningObjectiveOrder: null,
      successCriterion: null,
      successCriterionSort: "",
      successCriterionOrder: null,
    })
  } else {
    let loPlaceholderCount = 0

    for (const assessmentObjective of assessmentObjectives) {
      const aoLabel = buildAssessmentObjectiveLabel(assessmentObjective.code, assessmentObjective.title)
      const aoSort = aoLabel.toLowerCase()
      const aoOrder = assessmentObjective.order_index ?? null
      const assessmentObjectiveId = assessmentObjective.assessment_objective_id ?? `ao-${aoSort}`

      const learningObjectives = assessmentObjective.learning_objectives ?? []

      if (learningObjectives.length === 0) {
        rows.push({
          level: null,
          levelDisplay: "",
          assessmentObjectiveId,
          assessmentObjectiveLabel: aoLabel,
          assessmentObjectiveSort: aoSort,
          assessmentObjectiveOrder: aoOrder,
          learningObjectiveId: `${assessmentObjectiveId}-placeholder-${loPlaceholderCount++}`,
          learningObjectiveTitle: "",
          learningObjectiveSort: "",
          learningObjectiveOrder: null,
          successCriterion: null,
          successCriterionSort: "",
          successCriterionOrder: null,
        })
        continue
      }

      for (const learningObjective of learningObjectives) {
        const loTitle = learningObjective.title ?? ""
        const loSort = loTitle.toLowerCase()
        const loOrder = learningObjective.order_index ?? null
        const learningObjectiveId = learningObjective.learning_objective_id ?? `${assessmentObjectiveId}-lo-${loPlaceholderCount++}`

        const successCriteria = (learningObjective.success_criteria ?? []).filter((criterion) => criterion.active)

        if (successCriteria.length === 0) {
          rows.push({
            level: null,
            levelDisplay: "",
            assessmentObjectiveId,
            assessmentObjectiveLabel: aoLabel,
            assessmentObjectiveSort: aoSort,
            assessmentObjectiveOrder: aoOrder,
            learningObjectiveId,
            learningObjectiveTitle: loTitle,
            learningObjectiveSort: loSort,
            learningObjectiveOrder: loOrder,
            successCriterion: null,
            successCriterionSort: "",
            successCriterionOrder: null,
          })
          continue
        }

        for (const criterion of successCriteria) {
          const levelValue = criterion.level ?? null
          rows.push({
            level: levelValue,
            levelDisplay: levelValue !== null ? String(levelValue) : "",
            assessmentObjectiveId,
            assessmentObjectiveLabel: aoLabel,
            assessmentObjectiveSort: aoSort,
            assessmentObjectiveOrder: aoOrder,
            learningObjectiveId,
            learningObjectiveTitle: loTitle,
            learningObjectiveSort: loSort,
            learningObjectiveOrder: loOrder,
            successCriterion: criterion.description ?? "",
            successCriterionSort: (criterion.description ?? "").toLowerCase(),
            successCriterionOrder: criterion.order_index ?? null,
          })
        }
      }
    }
  }

  rows.sort((a, b) => {
    const levelA = a.level ?? Number.NEGATIVE_INFINITY
    const levelB = b.level ?? Number.NEGATIVE_INFINITY

    if (levelA !== levelB) {
      return levelB - levelA
    }

    const aoOrderA = a.assessmentObjectiveOrder ?? Number.POSITIVE_INFINITY
    const aoOrderB = b.assessmentObjectiveOrder ?? Number.POSITIVE_INFINITY
    if (aoOrderA !== aoOrderB) {
      return aoOrderA - aoOrderB
    }

    const aoSortComparison = a.assessmentObjectiveSort.localeCompare(b.assessmentObjectiveSort)
    if (aoSortComparison !== 0) {
      return aoSortComparison
    }

    const loOrderA = a.learningObjectiveOrder ?? Number.POSITIVE_INFINITY
    const loOrderB = b.learningObjectiveOrder ?? Number.POSITIVE_INFINITY
    if (loOrderA !== loOrderB) {
      return loOrderA - loOrderB
    }

    const loSortComparison = a.learningObjectiveSort.localeCompare(b.learningObjectiveSort)
    if (loSortComparison !== 0) {
      return loSortComparison
    }

    const scOrderA = a.successCriterionOrder ?? Number.POSITIVE_INFINITY
    const scOrderB = b.successCriterionOrder ?? Number.POSITIVE_INFINITY
    if (scOrderA !== scOrderB) {
      return scOrderA - scOrderB
    }

    return a.successCriterionSort.localeCompare(b.successCriterionSort)
  })

  type MergeGroup = { startRow: number; endRow: number; value: string }

  const levelGroups: MergeGroup[] = []
  const aoGroups: MergeGroup[] = []

  let currentLevelValue: number | null | undefined
  let currentLevelGroup: MergeGroup | null = null
  let currentAoIdentifier: string | null = null
  let currentAoGroup: MergeGroup | null = null
  let currentLearningObjectiveId: string | null = null

  for (const entry of rows) {
    const row = worksheet.addRow(["", "", "", ""])
    const rowNumber = row.number

    const hasLevelValue = entry.level !== null && entry.level !== undefined
    if (currentLevelValue !== entry.level || (hasLevelValue && currentLevelGroup === null)) {
      currentLevelValue = entry.level
      currentLevelGroup = hasLevelValue
        ? { startRow: rowNumber, endRow: rowNumber, value: entry.levelDisplay }
        : null
      if (currentLevelGroup) {
        levelGroups.push(currentLevelGroup)
        row.getCell(1).value = entry.levelDisplay
      } else {
        row.getCell(1).value = entry.levelDisplay
      }
      currentAoIdentifier = null
      currentAoGroup = null
      currentLearningObjectiveId = null
    } else {
      if (currentLevelGroup) {
        currentLevelGroup.endRow = rowNumber
      }
    }

    if (currentLevelGroup) {
      currentLevelGroup.endRow = rowNumber
    }

    const levelKeyPart = hasLevelValue ? `level-${entry.level}` : `level-null-${entry.assessmentObjectiveId}`
    const aoIdentifier = `${levelKeyPart}|${entry.assessmentObjectiveId}`
    if (currentAoIdentifier !== aoIdentifier) {
      currentAoIdentifier = aoIdentifier
      currentAoGroup = {
        startRow: rowNumber,
        endRow: rowNumber,
        value: entry.assessmentObjectiveLabel,
      }
      aoGroups.push(currentAoGroup)
      row.getCell(2).value = entry.assessmentObjectiveLabel
      currentLearningObjectiveId = null
    } else if (currentAoGroup) {
      currentAoGroup.endRow = rowNumber
    }

    if (currentAoGroup) {
      currentAoGroup.endRow = rowNumber
    }

    if (currentLearningObjectiveId !== entry.learningObjectiveId) {
      currentLearningObjectiveId = entry.learningObjectiveId
      row.getCell(3).value = entry.learningObjectiveTitle
    } else {
      row.getCell(3).value = ""
    }

    row.getCell(4).value = entry.successCriterion ?? ""

    row.getCell(3).alignment = { vertical: "top", wrapText: true }
    row.getCell(4).alignment = { vertical: "top", wrapText: true }
  }

  const createThick = () => ({ style: "thick" as const })
  const createHeavyBorder = () => ({
    top: createThick(),
    left: createThick(),
    bottom: createThick(),
    right: createThick(),
  })

  for (const group of levelGroups) {
    if (group.endRow > group.startRow) {
      worksheet.mergeCells(group.startRow, 1, group.endRow, 1)
    }
    const cell = worksheet.getCell(group.startRow, 1)
    cell.value = group.value
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    cell.border = createHeavyBorder()
  }

  for (const group of aoGroups) {
    if (group.endRow > group.startRow) {
      worksheet.mergeCells(group.startRow, 2, group.endRow, 2)
    }
    const startRow = group.startRow
    const endRow = group.endRow
    const leftCol = 2
    const rightCol = 4

    const cell = worksheet.getCell(startRow, leftCol)
    cell.value = group.value
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true }

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
      for (let columnIndex = leftCol; columnIndex <= rightCol; columnIndex += 1) {
        const borderCell = worksheet.getCell(rowIndex, columnIndex)
        const existing = borderCell.border ?? {}
        borderCell.border = {
          top: rowIndex === startRow ? createThick() : existing.top,
          bottom: rowIndex === endRow ? createThick() : existing.bottom,
          left: columnIndex === leftCol ? createThick() : existing.left,
          right: columnIndex === rightCol ? createThick() : existing.right,
        }
      }
    }
  }

  // Ensure level column remains blank when there was no numeric level value
  if (rows.length > 0 && levelGroups.length === 0) {
    const lastRowNumber = worksheet.lastRow?.number ?? headerRow.number
    for (let i = headerRow.number + 1; i <= lastRowNumber; i += 1) {
      const cell = worksheet.getCell(i, 1)
      cell.alignment = { vertical: "top", horizontal: "left" }
    }
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const filename = `${createFilename(curriculum.title, curriculumId)}.xlsx`

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "no-store",
    },
  })
}

function buildAssessmentObjectiveLabel(code?: string | null, title?: string | null) {
  const trimmedCode = code?.trim()
  const trimmedTitle = title?.trim()

  if (trimmedCode && trimmedTitle) {
    return `${trimmedCode} - ${trimmedTitle}`
  }

  return trimmedCode ?? trimmedTitle ?? "Assessment objective"
}

function createFilename(title: string, fallbackId: string) {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  if (base.length === 0) {
    return `curriculum-${fallbackId}`
  }

  return base.slice(0, 80)
}
