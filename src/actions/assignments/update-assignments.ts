import { Assignment, AssignmentSchema } from "./types";
import { z} from "zod";
import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server"


const ReturnValueSchema = z.object({
    data: AssignmentSchema.nullable(),
    error: z.string().nullable()
});

type ReturnValue = z.infer<typeof ReturnValueSchema>;

export const updateAssignment = async (prev: {data: Assignment | null, error: string | null}, assignment: Assignment):Promise<ReturnValue> => {

    let data =null, error=null;
    try{
        const supabase = await createSupabaseServerClient()

        const result = await supabase
                .from("assignments")
                .upsert(assignment)
                .select()
                .single();

        if(result.error) throw new Error(result.error.message);

        data = result.data;

        
        revalidatePath("/assignments");

    }
    catch(err){
        error = (err as Error).message;
        console.error("Error updating assignment:", err);
    }
    finally{
        return ReturnValueSchema.parse({data, error});
    }
}
