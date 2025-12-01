import { Group, GroupSchema } from "./types";
import { z} from "zod";
import { revalidatePath } from "next/cache";

import { query } from "@/lib/db"


const ReturnValueSchema = z.object({
    data: GroupSchema.nullable(),
    error: z.string().nullable()
});

type ReturnValue = z.infer<typeof ReturnValueSchema>;

export const updateGroup = async (prev: {data: Group | null, error: string | null}, group: Group):Promise<ReturnValue> => {

    let data =null, error=null;
    try{
        const { rows } = await query(
          `
            insert into groups (group_id, subject, join_code, active)
            values ($1, $2, $3, coalesce($4, true))
            on conflict (group_id)
            do update set subject = excluded.subject, join_code = excluded.join_code, active = excluded.active
            returning *
          `,
          [group.group_id, group.subject, group.join_code ?? null, group.active],
        )

        data = rows?.[0] ?? null;

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
