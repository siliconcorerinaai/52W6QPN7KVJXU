import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { findMore } from "@/lib/pipeline/campaigns";

const Body = z.object({ extra: z.number().int().min(1).max(500).default(10) });

export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const { extra } = Body.parse(await req.json().catch(() => ({})));
    await findMore(id, extra);
    return json({ ok: true });
  });
}
