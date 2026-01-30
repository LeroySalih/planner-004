"use server";

import { query } from "@/lib/db";

export interface Specification {
    specification_id: string;
    title: string;
    subject: string;
    exam_board: string | null;
    level: string | null;
    active: boolean;
}

export interface SpecificationDetail extends Specification {
    units: SpecificationUnit[];
}

export interface SpecificationUnit {
    unit_id: string;
    specification_id: string;
    number: string | null;
    title: string;
    order_index: number;
    active: boolean;
    key_ideas: KeyIdea[];
}

export interface KeyIdea {
    key_idea_id: string;
    unit_id: string;
    number: string | null;
    title: string;
    description: string | null;
    order_index: number;
    active: boolean;
    sub_items: SubItem[];
}

export interface SubItem {
    sub_item_id: string;
    key_idea_id: string;
    number: string | null;
    title: string | null;
    order_index: number;
    active: boolean;
    linked_lo_count: number;
    points: SubItemPoint[];
}

export interface SubItemPoint {
    point_id: string;
    sub_item_id: string;
    label: string | null;
    content: string;
    order_index: number;
    active: boolean;
}

export async function listSpecificationsAction() {
    const result = await query(`
    SELECT *
    FROM specifications
    WHERE active = true
    ORDER BY title
  `);
    return { success: true, data: result.rows as unknown as Specification[] };
}

export async function readSpecificationDetailAction(specificationId: string) {
    try {
        // 1. Fetch Specification
        const specResult = await query(
            `SELECT * FROM specifications WHERE specification_id = $1`,
            [specificationId],
        );

        if (specResult.rows.length === 0) {
            return { success: false, error: "Specification not found" };
        }
        const specification = specResult.rows[0] as unknown as Specification;

        // 2. Fetch Units
        const unitsResult = await query(
            `SELECT * FROM specification_units WHERE specification_id = $1 AND active = true ORDER BY order_index, number`,
            [specificationId],
        );
        const units = unitsResult.rows as unknown as SpecificationUnit[];

        // 3. Fetch Key Ideas
        const unitIds = units.map((u) => u.unit_id);
        const keyIdeasResult = await query(
            `SELECT * FROM key_ideas WHERE unit_id = ANY($1) AND active = true ORDER BY order_index, number`,
            [unitIds],
        );
        const keyIdeas = keyIdeasResult.rows as unknown as KeyIdea[];

        // 4. Fetch Sub Items with LO Count
        const keyIdeaIds = keyIdeas.map((ki) => ki.key_idea_id);
        const subItemsResult = await query(
            `SELECT
         si.*,
         (SELECT COUNT(*)
          FROM lo_links ll
          WHERE ll.sub_item_id = si.sub_item_id) as linked_lo_count
       FROM sub_items si
       WHERE si.key_idea_id = ANY($1) AND si.active = true
       ORDER BY si.order_index, si.number`,
            [keyIdeaIds],
        );
        const subItems = subItemsResult
            .rows as unknown as (SubItem & { linked_lo_count: number })[];

        // 5. Fetch Points
        const subItemIds = subItems.map((si) => si.sub_item_id);
        const pointsResult = await query(
            `SELECT * FROM sub_item_points WHERE sub_item_id = ANY($1) AND active = true ORDER BY order_index`,
            [subItemIds],
        );
        const points = pointsResult.rows as unknown as SubItemPoint[];

        // Construct hierarchy
        const result = {
            ...specification,
            units: units.map((unit) => ({
                ...unit,
                key_ideas: keyIdeas
                    .filter((ki) => ki.unit_id === unit.unit_id)
                    .map((ki) => ({
                        ...ki,
                        sub_items: subItems
                            .filter((si) => si.key_idea_id === ki.key_idea_id)
                            .map((si) => ({
                                ...si,
                                points: points.filter((p) =>
                                    p.sub_item_id === si.sub_item_id
                                ),
                            })),
                    })),
            })),
        };

        return { success: true, data: result };
    } catch (error) {
        console.error("Failed to read specification detail:", error);
        return { success: false, error: "Failed to read specification detail" };
    }
}

import { getSessionProfileAction } from "@/lib/server-actions/auth";

export async function readSubItemDetailAction(subItemId: string) {
    try {
        // 1. Fetch Sub Item details with hierarchy info
        const subItemResult = await query(
            `SELECT
         si.*,
         ki.title as key_idea_title,
         ki.number as key_idea_number,
         su.title as unit_title,
         su.number as unit_number,
         s.title as specification_title,
         s.specification_id
       FROM sub_items si
       JOIN key_ideas ki ON ki.key_idea_id = si.key_idea_id
       JOIN specification_units su ON su.unit_id = ki.unit_id
       JOIN specifications s ON s.specification_id = su.specification_id
       WHERE si.sub_item_id = $1`,
            [subItemId],
        );

        if (subItemResult.rows.length === 0) {
            return { success: false, error: "Sub Item not found" };
        }

        const subItem = subItemResult.rows[0];

        // 2. Fetch Linked Learning Objectives with context
        const loResult = await query(
            `SELECT
         lo.learning_objective_id,
         lo.title as lo_title,
         l.title as lesson_title,
         l.lesson_id,
         u.title as unit_title,
         u.unit_id
       FROM learning_objectives lo
       JOIN lo_links ll ON ll.learning_objective_id = lo.learning_objective_id
       JOIN lessons_learning_objective llo ON llo.learning_objective_id = lo.learning_objective_id
       JOIN lessons l ON l.lesson_id = llo.lesson_id
       JOIN units u ON u.unit_id = l.unit_id
       WHERE ll.sub_item_id = $1
       ORDER BY u.title, l.order_by, lo.order_index`,
            [subItemId],
        );

        let linkedObjectives = loResult.rows as any[];

        // 3. Filter/Flag for Pupils
        const session = await getSessionProfileAction();
        let assignedLessonIds = new Set<string>();

        if (session && session.roles.includes("pupil")) {
            const assignmentResult = await query(
                `SELECT DISTINCT la.lesson_id
                  FROM lesson_assignments la
                  JOIN group_membership gm ON gm.group_id = la.group_id
                  WHERE gm.user_id = $1`,
                [session.userId],
            );
            assignedLessonIds = new Set(
                assignmentResult.rows.map((r) => r.lesson_id as string),
            );
        }

        // Group by LO
        const loMap = new Map<string, any>();

        for (const row of linkedObjectives) {
            if (!loMap.has(row.learning_objective_id)) {
                loMap.set(row.learning_objective_id, {
                    learning_objective_id: row.learning_objective_id,
                    lo_title: row.lo_title,
                    unit_title: row.unit_title,
                    lessons: [],
                });
            }

            const lo = loMap.get(row.learning_objective_id);
            lo.lessons.push({
                lesson_id: row.lesson_id,
                lesson_title: row.lesson_title,
                is_assigned: session && session.roles.includes("pupil")
                    ? assignedLessonIds.has(row.lesson_id)
                    : true, // Teachers see all as "assigned/visible" effectively
            });
        }

        // Convert map values to array
        const groupedObjectives = Array.from(loMap.values());

        return {
            success: true,
            data: {
                subItem,
                linkedObjectives: groupedObjectives,
            },
        };
    } catch (error) {
        console.error("Failed to read sub item detail:", error);
        return { success: false, error: "Failed to read sub item detail" };
    }
}
