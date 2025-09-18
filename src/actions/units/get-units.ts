"use server"

// --file: src/actions/units/get-units.ts

import { supabaseServer } from "@/lib/supabaseClient"
import { UnitsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: UnitsSchema.nullable(),
    error: z.string().nullable()
});

export async function getUnits() {
  
    let data = null, error = null;

    try {

        const result = await supabaseServer
                .from("units")
                .select("*")

        if (result.error) throw new Error(result.error.message);

        data = result.data;

    } catch (err) { 
        console.error("Error fetching units:", err);
        error = (err as Error).message;
    }

    finally{
        return ReturnValSchema.parse({data, error});
    }
}
    