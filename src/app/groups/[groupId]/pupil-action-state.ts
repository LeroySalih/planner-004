export type PupilActionState = {
  status: "idle" | "success" | "error"
  message: string | null
  userId: string | null
  displayName: string | null
}

export const initialPupilActionState: PupilActionState = {
  status: "idle",
  message: null,
  userId: null,
  displayName: null,
}
