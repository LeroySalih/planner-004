import { query } from "@/lib/db";

export async function getSystemSetting<T>(key: string): Promise<T | null> {
    const result = await query<{ setting_value: T }>(
        `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
        [key],
    );
    return result.rows[0]?.setting_value ?? null;
}

export async function setSystemSetting<T>(
    key: string,
    value: T,
): Promise<void> {
    await query(
        `INSERT INTO system_settings (setting_key, setting_value)
     VALUES ($1, $2)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value`,
        [key, JSON.stringify(value)],
    );
}
