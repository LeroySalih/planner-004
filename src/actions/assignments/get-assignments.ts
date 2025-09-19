"use server"

// --file: src/actions/groups/get-groups.ts

import { supabaseServer } from "@/lib/supabaseClient"
import { AssignmentsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: AssignmentsSchema.nullable(),
    error: z.string().nullable()
});

export async function getAssignments() {
  try {
    const { data, error } = await supabaseServer
      .from("assignments")
      .select("*");

    if (error) throw new Error(error.message);

    return ReturnValSchema.parse({ data, error: null });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    console.error("Error fetching assignments:", caught);
    return ReturnValSchema.parse({ data: null, error: message });
  }
}
