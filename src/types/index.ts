import { z } from "zod"


export const GroupSchema = z.object({
    group_id: z.string(),
    subject: z.string().min(1).max(255),
    join_code: z.string(),
    active: z.boolean().default(true),
});

export const GroupsSchema = z.array(GroupSchema);

export type Group = z.infer<typeof GroupSchema>;
export type Groups = z.infer<typeof GroupsSchema>;
export type AssignmentChangeEvent = "create" | "edit" | "delete" | "unit-title-click"

export const UnitSchema = z.object({
    unit_id: z.string(),
    title: z.string().min(1).max(255),
    subject: z.string().min(1).max(255),
    active: z.boolean().optional(),
});

export const UnitsSchema = z.array(UnitSchema);

export type Unit = z.infer<typeof UnitSchema>;
export type Units = z.infer<typeof UnitsSchema>;

export const SubjectSchema = z.object({
    subject: z.string().min(1).max(255),
    active: z.boolean().default(true),
});

export const SubjectsSchema = z.array(SubjectSchema);

export type Subject = z.infer<typeof SubjectSchema>;
export type Subjects = z.infer<typeof SubjectsSchema>;

export const AssignmentSchema = z.object({
    group_id: z.string(),
    unit_id: z.string(),
    start_date: z.string().refine(date => !isNaN(Date.parse(date)), {
        message: "Invalid date format"
    }),
    end_date: z.string().refine(date => !isNaN(Date.parse(date)), {
        message: "Invalid date format"
    }),
    active: z.boolean().optional(),
});

export const AssignmentsSchema = z.array(AssignmentSchema);

export type Assignment = z.infer<typeof AssignmentSchema>;
export type Assignments = z.infer<typeof AssignmentsSchema>;
