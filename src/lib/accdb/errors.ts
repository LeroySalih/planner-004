// What the Access database reader says when a pupil's file cannot be read.
// The messages are written for the pupil: they are shown at upload and, when
// a read holds a submission, to the teacher.

/**
 * The file itself is bad: not an Access database, an older .mdb, a lock file,
 * damaged or password-protected. Anything else that goes wrong while reading
 * (mdbtools missing, a timeout, too much output) is a plain Error, so a job
 * that retries can tell the two apart.
 */
export class UnreadableDatabaseError extends Error {}

export const DATABASE_MESSAGES = {
  mdb: "This is an older Access .mdb file. Open it in Access and save it as an Access Database (.accdb), then upload that.",
  lockFile: "This is Access's lock file (.laccdb), not your database. Close Access and upload the .accdb file.",
  notAccess: "This is not an Access database (.accdb) file.",
  unopenable:
    "DINO could not open this database. If it has a password, remove it (File > Info > Decrypt Database); otherwise it may be damaged: use Compact and Repair in Access, then upload it again.",
  notThisType: "Upload your Access database as an .accdb file.",
} as const
