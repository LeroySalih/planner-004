"use server"

// --file: src/actions/groups/get-groups.ts

import { query } from "@/lib/db"
import { AssignmentsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: AssignmentsSchema.nullable(),
    error: z.string().nullable()
});

export async function getAssignments() {
  try {
    const { rows } = await query("select * from assignments")
    return ReturnValSchema.parse({ data: rows ?? [], error: null });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    console.error("Error fetching assignments:", caught);
    return ReturnValSchema.parse({ data: null, error: message });
  }
}
