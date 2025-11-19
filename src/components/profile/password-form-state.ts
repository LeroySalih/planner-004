export type PasswordActionState = {
  status: "idle" | "success" | "error"
  message: string | null
}

export const INITIAL_PASSWORD_ACTION_STATE: PasswordActionState = {
  status: "idle",
  message: null,
}
