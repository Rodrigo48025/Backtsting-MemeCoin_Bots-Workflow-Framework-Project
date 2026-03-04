"use server";

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function clearRejectedTargets() {
    try {
        await query("TRUNCATE TABLE rejected_targets");
        revalidatePath("/");
        return { success: true };
    } catch (error) {
        console.error("❌ Failed to clear rejected targets:", error);
        return { success: false, error: "Database error" };
    }
}

export async function clearMonitoredTargets() {
    try {
        await query("TRUNCATE TABLE target_queue");
        revalidatePath("/");
        return { success: true };
    } catch (error) {
        console.error("❌ Failed to clear monitored targets:", error);
        return { success: false, error: "Database error" };
    }
}
