// Raised when an Office file cannot be read. `message` is written for a pupil
// or teacher; `detail` is for logs. Each file kind has its own subclass, so a
// caller can tell a PowerPoint refusal from a Word one.
export class OfficeFileError extends Error {
  readonly detail: string

  constructor(message: string, detail = "") {
    super(message)
    this.name = "OfficeFileError"
    this.detail = detail
  }
}

export class PptxInspectError extends OfficeFileError {
  constructor(message: string, detail = "") {
    super(message, detail)
    this.name = "PptxInspectError"
  }
}

export class DocxReadError extends OfficeFileError {
  constructor(message: string, detail = "") {
    super(message, detail)
    this.name = "DocxReadError"
  }
}
