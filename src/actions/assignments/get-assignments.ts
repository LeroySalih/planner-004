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
  
    let data = null, error = null;

    try {

        const result = await supabaseServer
                .from("assignments")
                .select("*")

        if (result.error) throw new Error(result.error.message);

        data = result.data;

    } 
    catch (error) {
        error = (error as Error).message;
        console.error("Error fetching assignments:", error);
    }
    finally{
        return ReturnValSchema.parse({data, error});
    }
  
}