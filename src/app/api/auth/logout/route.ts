import { cookies } from "next/headers";
import { handle, json } from "@/lib/api";
import { deleteSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    const jar = await cookies();
    await deleteSession(jar.get(SESSION_COOKIE)?.value);
    jar.delete(SESSION_COOKIE);
    return json({ ok: true });
  });
}
