import { z } from "zod";
import { cookies } from "next/headers";
import { handle, json } from "@/lib/api";
import { checkSignupRate, createSession, createUser, SESSION_COOKIE } from "@/lib/auth";
import { sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().max(200), name: z.string().max(120).optional(), password: z.string().max(200) });

export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
    await checkSignupRate(ip ?? null);
    const user = await createUser(body);
    const { token, expiresAt } = await createSession(user.id, req.headers.get("user-agent"));
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return json({ user: { email: user.email, name: user.name } }, 201);
  });
}
