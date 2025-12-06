import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"

export type LogPupilSignInInput = {
  pupilId: string
  url: string
  signedInAt?: string
}

export async function logPupilSignIn(input: LogPupilSignInInput): Promise<void> {
  const { pupilId, url } = input
  const signedInAt = input.signedInAt ?? new Date().toISOString()

  await withTelemetry(
    {
      routeTag: "pupil_sign_in",
      functionName: "logPupilSignIn",
      params: { pupilId, url },
    },
    async () => {
      await query(
        `
          insert into pupil_sign_in_history (pupil_id, url, signed_in_at)
          values ($1, $2, $3)
        `,
        [pupilId, url, signedInAt],
      )
    },
  )
}
