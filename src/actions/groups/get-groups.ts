"use server"

// --file: src/actions/groups/get-groups.ts

import { supabaseServer } from "@/lib/supabaseClient"
import { GroupsSchema } from "./types";

import {z} from "zod";

const ReturnValSchema = z.object({
    data: GroupsSchema.nullable(),
    error: z.string().nullable()
});

export async function getGroups() {
  
    let data = null, error = null;

    try {

        const result = await supabaseServer
                .from("groups")
                .select("*")

        if (result.error) throw new Error(result.error.message);

        data = result.data;

    } 
    catch (error) {
        error = (error as Error).message;
        console.error("Error fetching groups:", error);
    }
    finally{
        return ReturnValSchema.parse({data, error});
    }
  
}