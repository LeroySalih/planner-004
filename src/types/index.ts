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

export const GroupMembershipSchema = z.object({
    group_id: z.string(),
    user_id: z.string(),
    role: z.string().min(1),
    profile: z
        .object({
            user_id: z.string(),
            first_name: z.string().nullable().optional(),
            last_name: z.string().nullable().optional(),
            is_teacher: z.boolean().default(false).optional(),
        })
        .optional(),
});

export const GroupMembershipsSchema = z.array(GroupMembershipSchema);

export type GroupMembership = z.infer<typeof GroupMembershipSchema>;
export type GroupMemberships = z.infer<typeof GroupMembershipsSchema>;

export const GroupMembershipWithGroupSchema = GroupMembershipSchema.extend({
    group: GroupSchema.optional(),
});

export const GroupMembershipsWithGroupSchema = z.array(GroupMembershipWithGroupSchema);

export type GroupMembershipWithGroup = z.infer<typeof GroupMembershipWithGroupSchema>;
export type GroupMembershipsWithGroup = z.infer<typeof GroupMembershipsWithGroupSchema>;

export const ProfileSchema = z.object({
    user_id: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    is_teacher: z.boolean().default(false),
});

export const ProfilesSchema = z.array(ProfileSchema);

export type Profile = z.infer<typeof ProfileSchema>;
export type Profiles = z.infer<typeof ProfilesSchema>;

export const FeedbackSchema = z.object({
    id: z.number().int(),
    user_id: z.string(),
    lesson_id: z.string(),
    success_criteria_id: z.string(),
    rating: z.number().int(),
});

export const FeedbacksSchema = z.array(FeedbackSchema);

export type Feedback = z.infer<typeof FeedbackSchema>;
export type Feedbacks = z.infer<typeof FeedbacksSchema>;

export const SubmissionSchema = z.object({
    submission_id: z.string(),
    activity_id: z.string(),
    user_id: z.string(),
    submitted_at: z
        .union([z.string(), z.date()])
        .transform((value) => (value instanceof Date ? value.toISOString() : value)),
    body: z.unknown().nullable().default(null),
});

export const SubmissionsSchema = z.array(SubmissionSchema);

export type Submission = z.infer<typeof SubmissionSchema>;
export type Submissions = z.infer<typeof SubmissionsSchema>;

export const GroupWithMembershipSchema = GroupSchema.extend({
    members: GroupMembershipsSchema.default([]),
});

export type GroupWithMembership = z.infer<typeof GroupWithMembershipSchema>;

export const UnitSchema = z.object({
    unit_id: z.string(),
    title: z.string().min(1).max(255),
    subject: z.string().min(1).max(255),
    description: z.string().nullable(),
    year: z.number().int().min(1).max(13).nullable(),
    active: z.boolean().optional(),
});

export const UnitsSchema = z.array(UnitSchema);

export type Unit = z.infer<typeof UnitSchema>;
export type Units = z.infer<typeof UnitsSchema>;

export const CurriculumSchema = z.object({
    curriculum_id: z.string(),
    subject: z.string().nullable(),
    title: z.string().min(1).max(255),
    description: z.string().nullable(),
    active: z.boolean().default(true),
});

export const CurriculaSchema = z.array(CurriculumSchema);

export type Curriculum = z.infer<typeof CurriculumSchema>;
export type Curricula = z.infer<typeof CurriculaSchema>;

export const AssessmentObjectiveSchema = z.object({
    assessment_objective_id: z.string(),
    curriculum_id: z.string().nullable(),
    unit_id: z.string().nullable(),
    code: z.string().min(1).max(10),
    title: z.string().min(1).max(255),
    order_index: z.number().default(0),
});

export const AssessmentObjectivesSchema = z.array(AssessmentObjectiveSchema);

export type AssessmentObjective = z.infer<typeof AssessmentObjectiveSchema>;
export type AssessmentObjectives = z.infer<typeof AssessmentObjectivesSchema>;

export const SuccessCriterionSchema = z.object({
    success_criteria_id: z.string(),
    learning_objective_id: z.string(),
    level: z.number().min(1).max(7).default(1),
    description: z.string().min(1),
    order_index: z.number().default(0),
    active: z.boolean().default(true),
    units: z.array(z.string()).default([]),
});

export const SuccessCriteriaSchema = z.array(SuccessCriterionSchema);

export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;
export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>;

export const SuccessCriterionUnitSchema = z.object({
    success_criteria_id: z.string(),
    unit_id: z.string(),
});

export const SuccessCriteriaUnitsSchema = z.array(SuccessCriterionUnitSchema);

export type SuccessCriterionUnit = z.infer<typeof SuccessCriterionUnitSchema>;
export type SuccessCriteriaUnits = z.infer<typeof SuccessCriteriaUnitsSchema>;

export const LessonSuccessCriterionSchema = z.object({
    lesson_id: z.string(),
    success_criteria_id: z.string(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    level: z.number().nullable().optional(),
    learning_objective_id: z.string().nullable().optional(),
});

export const LessonSuccessCriteriaSchema = z.array(LessonSuccessCriterionSchema);

export type LessonSuccessCriterion = z.infer<typeof LessonSuccessCriterionSchema>;
export type LessonSuccessCriteria = z.infer<typeof LessonSuccessCriteriaSchema>;

export const ActivitySuccessCriterionSchema = z.object({
    success_criteria_id: z.string(),
    learning_objective_id: z.string().nullable().optional(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    level: z.number().nullable().optional(),
    active: z.boolean().nullable().optional(),
});

export const ActivitySuccessCriteriaSchema = z.array(ActivitySuccessCriterionSchema);

export type ActivitySuccessCriterion = z.infer<typeof ActivitySuccessCriterionSchema>;
export type ActivitySuccessCriteria = z.infer<typeof ActivitySuccessCriteriaSchema>;

export const LearningObjectiveSchema = z.object({
    learning_objective_id: z.string(),
    assessment_objective_id: z.string(),
    title: z.string().min(1).max(255),
    order_index: z.number().default(0),
    active: z.boolean().default(true),
    assessment_objective_code: z.string().nullable().optional(),
    assessment_objective_title: z.string().nullable().optional(),
    assessment_objective_order_index: z.number().nullable().optional(),
});

export const LearningObjectivesSchema = z.array(LearningObjectiveSchema);

export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;
export type LearningObjectives = z.infer<typeof LearningObjectivesSchema>;

export const SuccessCriterionWithUnitsSchema = SuccessCriterionSchema.extend({
    success_criteria_units: SuccessCriteriaUnitsSchema.optional(),
});

export const LearningObjectiveWithCriteriaSchema = LearningObjectiveSchema.extend({
    success_criteria: SuccessCriteriaSchema.default([]),
});

export const AssessmentObjectiveDetailSchema = AssessmentObjectiveSchema.extend({
    learning_objectives: z.array(LearningObjectiveWithCriteriaSchema).default([]),
});

export const CurriculumDetailSchema = CurriculumSchema.extend({
    assessment_objectives: z.array(AssessmentObjectiveDetailSchema).default([]),
});

export type SuccessCriterionWithUnits = z.infer<typeof SuccessCriterionWithUnitsSchema>;
export type LearningObjectiveWithCriteria = z.infer<typeof LearningObjectiveWithCriteriaSchema>;
export type AssessmentObjectiveDetail = z.infer<typeof AssessmentObjectiveDetailSchema>;
export type CurriculumDetail = z.infer<typeof CurriculumDetailSchema>;

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

export const LessonFeedbackSummarySchema = z.object({
    group_id: z.string(),
    lesson_id: z.string(),
    total_pupils: z.number().int().min(0),
    positive_count: z.number().int().min(0),
    negative_count: z.number().int().min(0),
    unmarked_count: z.number().int().min(0),
});

export const LessonFeedbackSummariesSchema = z.array(LessonFeedbackSummarySchema);

export type LessonFeedbackSummary = z.infer<typeof LessonFeedbackSummarySchema>;
export type LessonFeedbackSummaries = z.infer<typeof LessonFeedbackSummariesSchema>;

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

export const McqOptionSchema = z.object({
    id: z.string().min(1),
    text: z.string().max(500),
    imageUrl: z.string().nullable().optional(),
});

export const McqActivityBodySchema = z
    .object({
        question: z.string().min(1),
        imageFile: z.string().min(1).nullable().optional(),
        imageUrl: z.string().nullable().optional(),
        imageAlt: z.string().nullable().optional(),
        options: z.array(McqOptionSchema).min(2).max(4),
        correctOptionId: z.string().min(1),
    })
    .refine(
        (value) => value.options.some((option) => option.id === value.correctOptionId),
        {
            message: "Correct option must match one of the provided options.",
            path: ["correctOptionId"],
        },
    );

export const LegacyMcqSubmissionBodySchema = z.object({
    optionId: z.string().min(1),
});

export const McqSubmissionBodySchema = z
    .object({
        answer_chosen: z.string().min(1),
        is_correct: z.boolean(),
        teacher_override_score: z.number().min(0).max(1).nullable().optional(),
        teacher_feedback: z.string().nullable().optional(),
        success_criteria_scores: z
            .record(z.string(), z.number().min(0).max(1).nullable())
            .default({}),
    })
    .passthrough();

export type McqOption = z.infer<typeof McqOptionSchema>;
export type McqActivityBody = z.infer<typeof McqActivityBodySchema>;
export type LegacyMcqSubmissionBody = z.infer<typeof LegacyMcqSubmissionBodySchema>;
export type McqSubmissionBody = z.infer<typeof McqSubmissionBodySchema>;

export const ShortTextActivityBodySchema = z
    .object({
        question: z.string().min(1),
        modelAnswer: z.string().min(1),
    })
    .passthrough();

export const ShortTextSubmissionBodySchema = z
    .object({
        answer: z.string().default(""),
        ai_model_score: z.number().min(0).max(1).nullable().optional(),
        teacher_override_score: z.number().min(0).max(1).nullable().optional(),
        is_correct: z.boolean().default(false),
        teacher_feedback: z.string().nullable().optional(),
        success_criteria_scores: z
            .record(z.string(), z.number().min(0).max(1).nullable())
            .default({}),
    })
    .passthrough();

export type ShortTextActivityBody = z.infer<typeof ShortTextActivityBodySchema>;
export type ShortTextSubmissionBody = z.infer<typeof ShortTextSubmissionBodySchema>;

export interface LessonSubmissionScore {
    userId: string;
    score: number | null;
    isCorrect?: boolean;
}

export interface LessonSubmissionSummary {
    activityId: string;
    activityTitle: string;
    activityType: string;
    totalSubmissions: number;
    averageScore: number | null;
    correctCount: number | null;
    scores: LessonSubmissionScore[];
    correctAnswer: string | null;
}

export const FeedbackActivityGroupSettingsSchema = z
    .object({
        isEnabled: z.boolean().default(false),
        showScore: z.boolean().default(false),
        showCorrectAnswers: z.boolean().default(false),
    })
    .passthrough();

export const FeedbackActivityBodySchema = z
    .object({
        groups: z
            .record(z.string().min(1), FeedbackActivityGroupSettingsSchema)
            .default({}),
    })
    .passthrough();

export type FeedbackActivityGroupSettings = z.infer<typeof FeedbackActivityGroupSettingsSchema>;
export type FeedbackActivityBody = z.infer<typeof FeedbackActivityBodySchema>;

export const LessonWithObjectivesSchema = LessonSchema.extend({
    lesson_objectives: LessonLearningObjectivesSchema.default([]),
    lesson_links: LessonLinksSchema.default([]),
    lesson_success_criteria: LessonSuccessCriteriaSchema.default([]),
});

export const LessonsWithObjectivesSchema = z.array(LessonWithObjectivesSchema);

export type LessonWithObjectives = z.infer<typeof LessonWithObjectivesSchema>;

export const LessonActivitySchema = z.object({
    activity_id: z.string(),
    lesson_id: z.string().nullish().transform((value) => value ?? ""),
    title: z.string().nullish().transform((value) => value ?? ""),
    type: z.string().nullish().transform((value) => value ?? ""),
    body_data: z.unknown().nullish().transform((value) => value ?? null),
    is_homework: z.boolean().nullish().transform((value) => value ?? false),
    is_summative: z.boolean().nullish().transform((value) => value ?? false),
    notes: z.string().nullish().transform((value) => value ?? ""),
    order_by: z.number().nullish().transform((value) => (typeof value === "number" ? value : null)),
    active: z.boolean().nullish().transform((value) => value ?? true),
    success_criteria_ids: z.array(z.string()).default([]),
    success_criteria: ActivitySuccessCriteriaSchema.default([]),
});

export const LessonActivitiesSchema = z.array(LessonActivitySchema);

export type LessonActivity = z.infer<typeof LessonActivitySchema>;
export type LessonActivities = z.infer<typeof LessonActivitiesSchema>;

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

export const AssignmentWithUnitSchema = AssignmentSchema.extend({
    unit: UnitSchema.optional().nullable(),
});

export const AssignmentsWithUnitSchema = z.array(AssignmentWithUnitSchema);

export type AssignmentWithUnit = z.infer<typeof AssignmentWithUnitSchema>;
export type AssignmentsWithUnit = z.infer<typeof AssignmentsWithUnitSchema>;

export const AssignmentResultPupilSchema = z.object({
    userId: z.string(),
    displayName: z.string(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
});

export const AssignmentResultActivitySuccessCriterionSchema = z.object({
    successCriteriaId: z.string(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    level: z.number().nullable().optional(),
});

export const AssignmentResultCriterionScoresSchema = z.record(
    z.string(),
    z.number().min(0).max(1).nullable(),
);

export const AssignmentResultActivitySchema = z.object({
    activityId: z.string(),
    title: z.string().default(""),
    type: z.string().default(""),
    orderIndex: z.number().nullable().optional(),
    successCriteria: z.array(AssignmentResultActivitySuccessCriterionSchema).default([]),
});

export const AssignmentResultCellSchema = z.object({
    activityId: z.string(),
    pupilId: z.string(),
    submissionId: z.string().nullable(),
    score: z.number().min(0).max(1).nullable(),
    autoScore: z.number().min(0).max(1).nullable(),
    overrideScore: z.number().min(0).max(1).nullable(),
    status: z.enum(["missing", "auto", "override"]).default("missing"),
    submittedAt: z.string().nullable(),
    feedback: z.string().nullable(),
    successCriteriaScores: AssignmentResultCriterionScoresSchema,
    autoSuccessCriteriaScores: AssignmentResultCriterionScoresSchema.optional(),
    overrideSuccessCriteriaScores: AssignmentResultCriterionScoresSchema.optional(),
});

export const AssignmentResultRowSchema = z.object({
    pupil: AssignmentResultPupilSchema,
    cells: z.array(AssignmentResultCellSchema),
    averageScore: z.number().min(0).max(1).nullable(),
});

export const AssignmentResultActivitySummarySchema = z.object({
    activityId: z.string(),
    averageScore: z.number().min(0).max(1).nullable(),
    submittedCount: z.number().int().min(0),
});

export const AssignmentResultSuccessCriterionSummarySchema = z.object({
    successCriteriaId: z.string(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    averageScore: z.number().min(0).max(1).nullable(),
    submittedCount: z.number().int().min(0),
    activityCount: z.number().int().min(0),
});

export const AssignmentResultMatrixSchema = z.object({
    assignmentId: z.string(),
    group: z
        .object({
            groupId: z.string(),
            subject: z.string().nullable(),
        })
        .nullable(),
    lesson: z
        .object({
            lessonId: z.string(),
            title: z.string().default(""),
            unitId: z.string().nullable(),
        })
        .nullable(),
    assignment: z
        .object({
            groupId: z.string(),
            lessonId: z.string(),
            startDate: z.string().nullable(),
        })
        .nullable(),
    pupils: z.array(AssignmentResultPupilSchema),
    activities: z.array(AssignmentResultActivitySchema),
    rows: z.array(AssignmentResultRowSchema),
    activitySummaries: z.array(AssignmentResultActivitySummarySchema).optional(),
    successCriteriaSummaries: z.array(AssignmentResultSuccessCriterionSummarySchema).optional(),
    overallAverage: z.number().min(0).max(1).nullable().optional(),
});

export type AssignmentResultPupil = z.infer<typeof AssignmentResultPupilSchema>;
export type AssignmentResultActivitySuccessCriterion = z.infer<typeof AssignmentResultActivitySuccessCriterionSchema>;
export type AssignmentResultCriterionScores = z.infer<typeof AssignmentResultCriterionScoresSchema>;
export type AssignmentResultActivity = z.infer<typeof AssignmentResultActivitySchema>;
export type AssignmentResultCell = z.infer<typeof AssignmentResultCellSchema>;
export type AssignmentResultRow = z.infer<typeof AssignmentResultRowSchema>;
export type AssignmentResultActivitySummary = z.infer<typeof AssignmentResultActivitySummarySchema>;
export type AssignmentResultSuccessCriterionSummary = z.infer<typeof AssignmentResultSuccessCriterionSummarySchema>;
export type AssignmentResultMatrix = z.infer<typeof AssignmentResultMatrixSchema>;
