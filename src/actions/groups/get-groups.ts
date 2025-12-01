"use server"

// --file: src/actions/groups/get-groups.ts

import { query } from "@/lib/db"
import { GroupsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: GroupsSchema.nullable(),
    error: z.string().nullable()
});

export async function getGroups() {
  try {
    const { rows } = await query("select * from groups where active = true")
    return ReturnValSchema.parse({ data: rows ?? [], error: null });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    console.error("Error fetching groups:", caught);
    return ReturnValSchema.parse({ data: null, error: message });
  }
}
