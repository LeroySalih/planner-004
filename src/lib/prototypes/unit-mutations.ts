import { UnitMutationStateSchema } from "@/types"
import type { UnitMutationState } from "@/types"

export const UNIT_MUTATION_INITIAL_STATE: UnitMutationState = UnitMutationStateSchema.parse({
  status: "idle",
  jobId: null,
  message: null,
})

export type { UnitMutationState }
