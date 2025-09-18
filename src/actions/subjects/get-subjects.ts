"use server"

// --file: src/actions/subjects/get-subjects.ts

import { supabaseServer } from "@/lib/supabaseClient"
import { SubjectsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: SubjectsSchema.nullable(),
    error: z.string().nullable()
});

export async function getSubjects() {
  
    let data = null, error = null;

    try {

        const result = await supabaseServer
                .from("subjects")
                .select("*")

        if (result.error) throw new Error(result.error.message);

        data = result.data;

    } catch (err) { 
        console.error("Error fetching subjects:", err);
        error = (err as Error).message;
    }

    finally{
        return ReturnValSchema.parse({data, error});
    }
}
    