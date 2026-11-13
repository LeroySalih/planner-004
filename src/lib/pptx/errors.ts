// Raised when a file cannot be inspected. `message` is written for a pupil or
// teacher; `detail` is for logs.
export class PptxInspectError extends Error {
  readonly detail: string

  constructor(message: string, detail = "") {
    super(message)
    this.name = "PptxInspectError"
    this.detail = detail
  }
}
