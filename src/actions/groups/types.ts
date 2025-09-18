// file: src/actions/groups/types.ts

import {z} from "zod";

export const GroupSchema = z.object({
    group_id: z.string(),
    subject: z.string().min(1).max(255),
});

export const GroupsSchema = z.array(GroupSchema);

export type Group = z.infer<typeof GroupSchema>;
export type Groups = z.infer<typeof GroupsSchema>;
