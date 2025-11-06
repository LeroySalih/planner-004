"use server"

import { z } from "zod"

import { SubjectsSchema } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { withTelemetry } from "@/lib/telemetry"

const SubjectsReturnValue = z.object({
  data: SubjectsSchema.nullable(),
  error: z.string().nullable(),
})

export async function readSubjectsAction(options?: { authEndTime?: number | null; routeTag?: string }) {
  const routeTag = options?.routeTag ?? "/subjects:readSubjects"

  return withTelemetry(
    {
      routeTag,
      functionName: "readSubjectsAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading subjects:")

      let error: string | null = null

      const supabase = await createSupabaseServerClient()

      const { data, error: readError } = await supabase
        .from("subjects")
        .select("*")
        .eq("active", true)

      if (readError) {
        error = readError.message
        console.error(error)
      }

      console.log("[v0] Server action completed for reading subjects:", error)

      return SubjectsReturnValue.parse({ data, error })
    },
  )
}
