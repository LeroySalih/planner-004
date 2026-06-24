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
  // Error-valued cells (e.g. #DIV/0!) come back as { error: string }; return the error text itself.
  if (typeof value === "object" && "error" in (value as unknown as Record<string, unknown>)) {
    return String((value as { error: unknown }).error);
  }
  // Rich text / hyperlink objects: fall back to their text representation.
  if (typeof value === "object" && "text" in (value as unknown as Record<string, unknown>)) {
    return String((value as { text: unknown }).text);
  }
  return String(value);
}

export async function parseSpreadsheet(buffer: Buffer): Promise<ParsedSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const sheets: ParsedSheet[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: ParsedCell[][] = [];

    // includeEmpty: false here skips blank trailing rows, while includeEmpty: true on
    // eachCell below preserves column alignment within rows that do have data.
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: ParsedCell[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        // Merged cells: only the master cell carries the value; the other cells in the
        // merged region report null here. This is exceljs's behavior and is fine for our use case.
        //
        // Use cell.type/cell.formula/cell.result rather than inspecting cell.value's raw
        // shape: a cell using Excel's "shared formula" optimization (one formula copied
        // down a range) has cell.value = { sharedFormula: "C2", result: 8 } with NO
        // `formula` property at all — only the master cell carries literal formula text.
        // cell.formula already resolves shared formulas to the cell's own relative
        // formula text (e.g. "A3+B3"), so this handles master and shared formulas alike.
        if (cell.type === ExcelJS.ValueType.Formula) {
          cells.push({
            value: toScalar(cell.result),
            formula: cell.formula,
            result: toScalar(cell.result),
          });
        } else {
          cells.push({ value: toScalar(cell.value) });
        }
      });
      rows.push(cells);
    });

    sheets.push({ sheetName: worksheet.name, rows });
  });

  return sheets;
}
