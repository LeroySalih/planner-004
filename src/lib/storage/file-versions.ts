// Uploading a file over one of the same name renames the old copy to
// `<base>_<DD-MM-YYYY_HH-MM-SS><.ext>` (buildVersionedName in local-storage.ts).
// A pupil's upload-file submission stamps a replaced file the same way with
// milliseconds added (`_DD-MM-YYYY_HH-MM-SS-mmm`), so those match too.
// A stamped name is a past version only when its current copy is in the same
// folder; one whose current copy has gone stays a file in its own right.

const VERSION_STAMP = /_\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}(?:-\d{3})?(\.[^./]+)?$/

export function currentFileName(name: string) {
  return name.replace(VERSION_STAMP, (_stamp, extension: string | undefined) => extension ?? "")
}

// Names in one folder that are past versions of another name in that folder.
export function pastVersionNames(names: string[]) {
  const present = new Set(names)
  return new Set(
    names.filter((name) => {
      const current = currentFileName(name)
      return current !== name && present.has(current)
    }),
  )
}
