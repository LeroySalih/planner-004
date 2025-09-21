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
    description: z.string().nullable(),
    active: z.boolean().optional(),
});

export const UnitsSchema = z.array(UnitSchema);

export type Unit = z.infer<typeof UnitSchema>;
export type Units = z.infer<typeof UnitsSchema>;

export const SuccessCriterionSchema = z.object({
    success_criteria_id: z.string(),
    learning_objective_id: z.string(),
    title: z.string().min(1).max(255),
});

export const SuccessCriteriaSchema = z.array(SuccessCriterionSchema);

export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;
export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>;

export const LearningObjectiveSchema = z.object({
    learning_objective_id: z.string(),
    unit_id: z.string(),
    title: z.string().min(1).max(255),
    order_by: z.number().default(0),
});

export const LearningObjectivesSchema = z.array(LearningObjectiveSchema);

export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;
export type LearningObjectives = z.infer<typeof LearningObjectivesSchema>;

export const LessonSchema = z.object({
    lesson_id: z.string(),
    unit_id: z.string(),
    title: z.string().min(1).max(255),
    order_by: z.number().default(0),
    active: z.boolean().default(true),
});

export const LessonsSchema = z.array(LessonSchema);

export type Lesson = z.infer<typeof LessonSchema>;
export type Lessons = z.infer<typeof LessonsSchema>;

export const LessonAssignmentSchema = z.object({
    group_id: z.string(),
    lesson_id: z.string(),
    start_date: z.string().refine(date => !isNaN(Date.parse(date)), {
        message: "Invalid date format"
    }),
});

export const LessonAssignmentsSchema = z.array(LessonAssignmentSchema);

export type LessonAssignment = z.infer<typeof LessonAssignmentSchema>;
export type LessonAssignments = z.infer<typeof LessonAssignmentsSchema>;

export const LessonLearningObjectiveSchema = z.object({
    learning_objective_id: z.string(),
    lesson_id: z.string(),
    order_by: z.number().default(0),
    title: z.string().min(1),
    active: z.boolean().default(true),
    learning_objective: LearningObjectiveSchema.extend({
        success_criteria: SuccessCriteriaSchema.optional(),
    }).optional(),
});

export const LessonLearningObjectivesSchema = z.array(LessonLearningObjectiveSchema);

export type LessonLearningObjective = z.infer<typeof LessonLearningObjectiveSchema>;
export type LessonLearningObjectives = z.infer<typeof LessonLearningObjectivesSchema>;

export const LessonLinkSchema = z.object({
    lesson_link_id: z.string(),
    lesson_id: z.string(),
    url: z.string().url(),
    description: z.string().nullable(),
});

export const LessonLinksSchema = z.array(LessonLinkSchema);

export type LessonLink = z.infer<typeof LessonLinkSchema>;
export type LessonLinks = z.infer<typeof LessonLinksSchema>;

export const LessonWithObjectivesSchema = LessonSchema.extend({
    lesson_objectives: LessonLearningObjectivesSchema.default([]),
    lesson_links: LessonLinksSchema.default([]),
});

export const LessonsWithObjectivesSchema = z.array(LessonWithObjectivesSchema);

export type LessonWithObjectives = z.infer<typeof LessonWithObjectivesSchema>;

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
