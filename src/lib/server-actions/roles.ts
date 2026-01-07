"use server"

import { revalidatePath } from "next/cache"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

export async function assignRoleAction(userId: string, roleId: string) {
  await requireRole("admin")

  try {
    // Ensure role exists first (optional but good practice)
    const { rows: roleRows } = await query("select 1 from roles where role_id = $1", [roleId])
    if (roleRows.length === 0) {
      return { success: false, error: "Role not found" }
    }

    await query(
      "insert into user_roles (user_id, role_id) values ($1, $2) on conflict do nothing",
      [userId, roleId]
    )
    
    // Legacy support: sync is_teacher if applicable
    if (roleId === 'teacher') {
        await query("update profiles set is_teacher = true where user_id = $1", [userId])
    }

    revalidatePath("/admin/roles")
    return { success: true }
  } catch (error) {
    console.error("[roles] Failed to assign role:", error)
    return { success: false, error: "Failed to assign role" }
  }
}

export async function removeRoleAction(userId: string, roleId: string) {
  await requireRole("admin")

  try {
    await query(
      "delete from user_roles where user_id = $1 and role_id = $2",
      [userId, roleId]
    )

    // Legacy support: sync is_teacher if applicable
    if (roleId === 'teacher') {
        await query("update profiles set is_teacher = false where user_id = $1", [userId])
    }

    revalidatePath("/admin/roles")
    return { success: true }
  } catch (error) {
    console.error("[roles] Failed to remove role:", error)
    return { success: false, error: "Failed to remove role" }
  }
}
