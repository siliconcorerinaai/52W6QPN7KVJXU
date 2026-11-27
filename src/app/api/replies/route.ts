import { z } from "zod";
import { handle, json } from "@/lib/api";
import { countNewReplies, listReplies } from "@/lib/pipeline/replies";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const Filter = z.enum(["todo", "interested", "question", "not_now", "all"]).catch("todo");

/** Réponses des prospects du compte. */
export async function GET(req: Request) {
  return handle(async () => {
    const owner = await requireUser();
    const filter = Filter.parse(new URL(req.url).searchParams.get("filter") ?? "todo");
    const [list, toHandle] = await Promise.all([listReplies(owner, filter), countNewReplies(owner)]);
    return json({ replies: list, toHandle });
  });
}
