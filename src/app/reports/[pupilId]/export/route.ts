import type PDFKit from "pdfkit"
import PDFDocumentFactory from "pdfkit/js/pdfkit.standalone"

import { getPreparedReportData, type PreparedReportData } from "../report-data"

const PAGE_MARGIN = 50
const FONT_PRIMARY = "Helvetica"
const FONT_PRIMARY_BOLD = "Helvetica-Bold"

const PDFDocument = PDFDocumentFactory as unknown as typeof PDFKit

function formatPercent(value: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—"
  }
  return `${Math.round(value * 100)}%`
}

export async function GET(request: Request, { params }: { params: Promise<{ pupilId: string }> }) {
  const { pupilId } = await params
  const { searchParams } = new URL(request.url)
  const groupIdFilter = searchParams.get("groupId") ?? undefined

  const prepared = await getPreparedReportData(pupilId, groupIdFilter)

  if (!prepared) {
    return new Response("Report not found", { status: 404 })
  }

  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN })
  const chunks: Buffer[] = []
  doc.on("data", (chunk) => chunks.push(chunk as Buffer))

  const pdfBufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })

  renderReport(doc, {
    ...prepared,
    pupilId,
    groupIdFilter,
  })

  doc.end()

  const pdfBuffer = await pdfBufferPromise
  const pdfArray = new Uint8Array(pdfBuffer)

  const fileName = encodeURIComponent(prepared.exportFileName)

  return new Response(pdfArray, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdfArray.byteLength),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}

function renderReport(doc: PDFKit.PDFDocument, data: PreparedReportData & { pupilId: string; groupIdFilter?: string }) {
  
  doc.font(FONT_PRIMARY_BOLD).fontSize(20).fillColor("#0f172a").text(data.profileName)

  doc.moveDown(0.5)

  const metaLines: string[] = [`Generated on ${data.formattedDate}`]
  if (data.groupIdFilter) {
    metaLines.push(`Group: ${data.groupIdFilter}`)
  }
  if (data.primaryMembership?.group?.subject) {
    metaLines.push(`Subject: ${data.primaryMembership.group.subject}`)
  }
  metaLines.push(`Pupil ID: ${data.pupilId}`)

  doc.font(FONT_PRIMARY).fontSize(10).fillColor("#4b5563")
  metaLines.forEach((line) => doc.text(line))

  doc.moveDown(1)

  if (data.subjectEntries.length === 0) {
    doc.font(FONT_PRIMARY).fontSize(12).fillColor("#374151").text("No units assigned yet.")
    return
  }

  data.subjectEntries.forEach((subjectEntry, subjectIndex) => {
    if (subjectIndex > 0) {
      doc.addPage()
    }

    renderSubjectSection(doc, subjectEntry)
  })
}

function renderSubjectSection(
  doc: PDFKit.PDFDocument,
  subjectEntry: PreparedReportData["subjectEntries"][number],
) {
  doc.font(FONT_PRIMARY_BOLD).fontSize(16).fillColor("#0f172a").text(subjectEntry.subject)
  doc
    .font(FONT_PRIMARY)
    .fontSize(10)
    .fillColor("#4b5563")
    .text(`Working at: ${subjectEntry.workingLevel ? `Level ${subjectEntry.workingLevel}` : "Not established"}`)

  doc.moveDown(0.75)

  subjectEntry.units.forEach((unit, unitIndex) => {
    renderUnit(doc, unit, unitIndex > 0)
  })
}

function renderUnit(
  doc: PDFKit.PDFDocument,
  unit: PreparedReportData["subjectEntries"][number]["units"][number],
  addSpacing: boolean,
) {
  if (addSpacing) {
    doc.moveDown(0.5)
  }

  doc.font(FONT_PRIMARY_BOLD).fontSize(13).fillColor("#0f172a").text(unit.unitTitle)
  doc
    .font(FONT_PRIMARY)
    .fontSize(9)
    .fillColor("#4b5563")
    .text(unit.unitDescription ?? "No description available.")
  doc
    .font(FONT_PRIMARY)
    .fontSize(9)
    .fillColor("#4b5563")
    .text(`Scores — Total: ${formatPercent(unit.totalAverage)} · Assessment: ${formatPercent(unit.summativeAverage)}`)
  doc
    .font(FONT_PRIMARY)
    .fontSize(9)
    .fillColor("#4b5563")
    .text(`Working at: ${unit.workingLevel ? `Level ${unit.workingLevel}` : "Not established"}`)

  if (unit.relatedGroups.length > 0) {
    doc.font(FONT_PRIMARY).fontSize(8).fillColor("#6b7280").text(`Groups: ${unit.relatedGroups.join(", ")}`)
  }

  doc.moveDown(0.35)

  if (unit.objectiveError) {
    doc.font(FONT_PRIMARY).fontSize(9).fillColor("#b91c1c").text(`Unable to load objectives: ${unit.objectiveError}`)
    if (unit.scoreError) {
      doc.font(FONT_PRIMARY).fontSize(9).fillColor("#b91c1c").text(`Unable to load scores: ${unit.scoreError}`)
    }
    return
  }

  if (unit.scoreError) {
    doc.font(FONT_PRIMARY).fontSize(9).fillColor("#b91c1c").text(`Unable to load scores: ${unit.scoreError}`)
    doc.moveDown(0.35)
  }

  if (unit.groupedLevels.length === 0) {
    doc.font(FONT_PRIMARY).fontSize(9).fillColor("#6b7280").text(
      "No success criteria are assigned to this group for the current units.",
    )
    return
  }

  unit.groupedLevels.forEach((group) => {
    doc.moveDown(0.35)
    doc.font(FONT_PRIMARY_BOLD).fontSize(11).fillColor("#0f172a").text(`Level ${group.level}`)

    group.rows.forEach((row) => {
      doc
        .font(FONT_PRIMARY_BOLD)
        .fontSize(9)
        .fillColor("#111827")
        .text(`${row.assessmentObjectiveCode}${row.assessmentObjectiveTitle ? ` – ${row.assessmentObjectiveTitle}` : ""}`, {
          indent: 10,
        })
      doc
        .font(FONT_PRIMARY)
        .fontSize(9)
        .fillColor("#1f2937")
        .text(`Objective: ${row.objectiveTitle}`, { indent: 20 })
      doc
        .font(FONT_PRIMARY)
        .fontSize(9)
        .fillColor("#1f2937")
        .text(`Criterion: ${row.criterionDescription ?? "No description provided."}`, { indent: 30 })
      doc
        .font(FONT_PRIMARY)
        .fontSize(9)
        .fillColor("#4b5563")
        .text(
          `Scores — Total: ${formatPercent(row.totalScore)} · Assessment: ${formatPercent(row.assessmentScore)}`,
          { indent: 30 },
        )

      doc.moveDown(0.2)
    })
  })
}
