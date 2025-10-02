import { z } from "zod";

export const UnitSchema = z.object({
    unit_id: z.string(),
    title: z.string().min(1).max(255),
    subject: z.string().min(1).max(255),
});

export const UnitsSchema = z.array(UnitSchema);

export type Unit = z.infer<typeof UnitSchema>;
export type Units = z.infer<typeof UnitsSchema>;
