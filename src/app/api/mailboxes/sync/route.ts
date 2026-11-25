import { handle, json } from "@/lib/api";
import { kickWorker } from "@/lib/jobs/kick";
import { maybeScheduleInboxSync } from "@/lib/jobs/schedule";

export const maxDuration = 300;

/** Lance tout de suite la lecture des boîtes de réception (réponses et rebonds). */
export async function POST() {
  return handle(async () => {
    const scheduled = await maybeScheduleInboxSync({ force: true });
    kickWorker();
    return json({ scheduled });
  });
}
