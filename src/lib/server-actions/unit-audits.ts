'use server'

import { unstable_rethrow } from 'next/navigation'

import { requireTeacherProfile } from '@/lib/auth'
import { withDbClient } from '@/lib/db'
import { readUnitAudit, type UnitAudit } from '@/lib/unit-audits/store'

// Audits are recorded over MCP (record_unit_audit); the app only shows them.

export async function readUnitAuditAction(unitId: string): Promise<{ data: UnitAudit | null; error: string | null }> {
  try {
    await requireTeacherProfile()
    return { data: await withDbClient((client) => readUnitAudit(client, unitId)), error: null }
  } catch (error) {
    unstable_rethrow(error)
    console.error('[unit-audits] read failed', error)
    return { data: null, error: 'Could not load the unit audit.' }
  }
}
