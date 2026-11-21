// The name a pupil's own assessment file downloads under, for whoever
// downloads it: "<First> <Last> - <file name>", so a teacher's downloads
// folder says whose work each file is. A name that already starts with the
// pupil's full name is left alone, and so is every name when the pupil has
// none. No server-only imports: tests and the browser may use it.

const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g
const MAX_NAME_CHARS = 80

/** Text with the characters a file system refuses taken out and spaces collapsed. */
export function fileNameSafe(text: string): string {
  return text.replace(UNSAFE_CHARACTERS, " ").replace(/\s+/g, " ").trim()
}

/** "<First> <Last>" from a profile row; empty when the pupil has no name. */
export function pupilFullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return fileNameSafe(`${firstName ?? ""} ${lastName ?? ""}`).slice(0, MAX_NAME_CHARS).trim()
}

/** `fileName` with the pupil's name in front, unless it is already there or there is none. */
export function pupilDownloadFileName(pupilName: string | null | undefined, fileName: string): string {
  const name = fileNameSafe(pupilName ?? "").slice(0, MAX_NAME_CHARS).trim()
  if (!name) return fileName
  const lowerFile = fileName.toLowerCase()
  const lowerName = name.toLowerCase()
  // "Ann Smith.pptx" or "Ann Smith - task.pptx" already says whose it is;
  // "Ann Smithson.pptx" does not.
  if (lowerFile.startsWith(lowerName) && !/^[\p{L}\p{N}]/u.test(lowerFile.slice(lowerName.length))) return fileName
  return `${name} - ${fileName}`
}

/**
 * A practical assessment's own file (the evidence template, a starting
 * database, a supplied image, the question paper) as it downloads:
 * "<lesson title> <file name>", so a pupil's downloads folder says which
 * assessment each file is for. Not doubled, and unchanged with no title.
 */
export function lessonDownloadFileName(lessonTitle: string | null | undefined, fileName: string): string {
  const title = fileNameSafe(lessonTitle ?? "").slice(0, MAX_NAME_CHARS).trim()
  if (!title) return fileName
  const lowerFile = fileName.toLowerCase()
  const lowerTitle = title.toLowerCase()
  if (lowerFile.startsWith(lowerTitle) && !/^[\p{L}\p{N}]/u.test(lowerFile.slice(lowerTitle.length))) return fileName
  return `${title} ${fileName}`
}
