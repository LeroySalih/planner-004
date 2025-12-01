"use server"

// --file: src/actions/subjects/get-subjects.ts

import { query } from "@/lib/db"
import { SubjectsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: SubjectsSchema.nullable(),
    error: z.string().nullable()
});

export async function getSubjects() {
  
    let data = null, error = null;

    try {

        const { rows } = await query("select * from subjects")
        data = rows ?? [];

    } catch (err) { 
        console.error("Error fetching subjects:", err);
        error = (err as Error).message;
    }

    finally{
        return ReturnValSchema.parse({data, error});
    }
}
    
