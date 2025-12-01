"use server"

// --file: src/actions/units/get-units.ts

import { query } from "@/lib/db"
import { UnitsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: UnitsSchema.nullable(),
    error: z.string().nullable()
});

export async function getUnits() {
  
    let data = null, error = null;

    try {

        const { rows } = await query("select * from units")
        data = rows ?? [];

    } catch (err) { 
        console.error("Error fetching units:", err);
        error = (err as Error).message;
    }

    finally{
        return ReturnValSchema.parse({data, error});
    }
}
    
