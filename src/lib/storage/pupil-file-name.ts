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
