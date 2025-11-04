import { FastUiActionStateSchema } from "@/types"
import type { FastUiActionState } from "@/types"

export const FAST_UI_INITIAL_STATE: FastUiActionState = FastUiActionStateSchema.parse({
  status: "idle",
  jobId: null,
  message: null,
})

export type { FastUiActionState }

export const FAST_UI_MAX_COUNTER = 4
