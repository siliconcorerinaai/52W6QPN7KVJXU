import { handle, json } from "@/lib/api";
import { kickWorker } from "@/lib/jobs/kick";
import { claimInterval, maybeScheduleInboxSync } from "@/lib/jobs/schedule";
import { requireUser } from "@/lib/session";

export const maxDuration = 300;

/** Lance tout de suite la lecture des boîtes de réception (réponses et rebonds). */
export async function POST() {
  return handle(async () => {
    await requireUser();
    // Lecture forcée au plus une fois par minute, tous comptes confondus.
    const scheduled = (await claimInterval("inbox_sync_manual", 1)) ? await maybeScheduleInboxSync({ force: true }) : false;
    kickWorker();
    return json({ scheduled });
  });
}
