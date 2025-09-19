import {z} from "zod";

export const SubjectSchema = z.object({
    subject: z.string().min(1).max(255),
});

export const SubjectsSchema = z.array(SubjectSchema);

export type Subject = z.infer<typeof SubjectSchema>;
export type Subjects = z.infer<typeof SubjectsSchema>;

