import { z } from "zod";
import { cookies } from "next/headers";
import { handle, json } from "@/lib/api";
import { authenticate, createSession, SESSION_COOKIE } from "@/lib/auth";
import { sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().max(200), password: z.string().max(200) });

export async function POST(req: Request) {
  return handle(async () => {
    const { email, password } = Body.parse(await req.json());
    const user = await authenticate(email, password);
    const { token, expiresAt } = await createSession(user.id, req.headers.get("user-agent"));
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return json({ user: { email: user.email, name: user.name } });
  });
}
