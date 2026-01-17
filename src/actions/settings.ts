"use server";

import { getSystemSetting, setSystemSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";

export type RevisionActivityTypes = {
    shortText: boolean;
    multipleChoice: boolean;
    singleChoice: boolean;
    uploadFile: boolean;
    uploadLink: boolean;
};

const SETTING_KEY = "revision_activity_types";

const DEFAULT_SETTINGS: RevisionActivityTypes = {
    shortText: true,
    multipleChoice: true,
    singleChoice: true,
    uploadFile: true,
    uploadLink: true,
};

export async function getRevisionSettings(): Promise<RevisionActivityTypes> {
    const settings = await getSystemSetting<RevisionActivityTypes>(SETTING_KEY);
    return settings ?? DEFAULT_SETTINGS;
}

export async function saveRevisionSettings(
    settings: RevisionActivityTypes,
): Promise<void> {
    await setSystemSetting(SETTING_KEY, settings);
    revalidatePath("/admin/settings");
}
