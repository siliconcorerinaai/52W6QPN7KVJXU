import { handle, json } from "@/lib/api";
import { listAccounts } from "@/lib/accounts";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Comptes clients avec leur usage du mois (administrateur uniquement). */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return json({ users: await listAccounts() });
  });
}
