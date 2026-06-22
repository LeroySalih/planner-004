import ExcelJS from "exceljs";

export type ParsedCell = {
  value: string | number | boolean | null;
  formula?: string;
  result?: string | number | boolean | null;
};

export type ParsedSheet = {
  sheetName: string;
  rows: ParsedCell[][];
};

function toScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  // Rich text / hyperlink objects: fall back to their text representation.
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text);
  }
  return String(value);
}

export async function parseSpreadsheet(buffer: Buffer): Promise<ParsedSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: ParsedSheet[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: ParsedCell[][] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: ParsedCell[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const raw = cell.value;
        if (
          raw !== null &&
          typeof raw === "object" &&
          "formula" in (raw as Record<string, unknown>)
        ) {
          const formulaValue = raw as { formula: string; result?: unknown };
          cells.push({
            value: toScalar(formulaValue.result),
            formula: formulaValue.formula,
            result: toScalar(formulaValue.result),
          });
        } else {
          cells.push({ value: toScalar(raw) });
        }
      });
      rows.push(cells);
    });

    sheets.push({ sheetName: worksheet.name, rows });
  });

  return sheets;
}
