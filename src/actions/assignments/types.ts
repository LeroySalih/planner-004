// file: src/actions/groups/types.ts

import {z} from "zod";

export const AssignmentSchema = z.object({
    group_id: z.string(),
    unit_id: z.string(),
    start_date: z.string().refine(date => !isNaN(Date.parse(date)), {
        message: "Invalid date format"
    }),
    end_date: z.string().refine(date => !isNaN(Date.parse(date)), {
        message: "Invalid date format"
    }),
    //
    
});

export const AssignmentsSchema = z.array(AssignmentSchema);

export type Group = z.infer<typeof AssignmentSchema>;
export type Groups = z.infer<typeof AssignmentsSchema>;
