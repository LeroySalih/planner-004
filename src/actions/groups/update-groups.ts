import { Group, GroupSchema } from "./types";
import { z} from "zod";
import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server"


const ReturnValueSchema = z.object({
    data: GroupSchema.nullable(),
    error: z.string().nullable()
});

type ReturnValue = z.infer<typeof ReturnValueSchema>;

export const updateGroup = async (prev: {data: Group | null, error: string | null}, group: Group):Promise<ReturnValue> => {

    let data =null, error=null;
    try{
        const supabase = await createSupabaseServerClient()

        const result = await supabase
                .from("groups")
                .upsert(group)
                .select()
                .single();

        if(result.error) throw new Error(result.error.message);

        data = result.data;

    }
    catch(err){
        error = (err as Error).message;
        console.error("Error updating group:", err);
    }
    finally{
        revalidatePath("/groups");
        return ReturnValueSchema.parse({data, error});
    }
}
