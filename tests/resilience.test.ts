import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La file et la base sont simulées : on vérifie seulement que le worker ne reste jamais bloqué.
const queue = vi.hoisted(() => ({
  claimJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  recoverStaleJobs: vi.fn(),
}));
const db = vi.hoisted(() => ({ resetDb: vi.fn() }));
const handlers = vi.hoisted(() => ({ runJob: vi.fn() }));

vi.mock("@/lib/jobs/queue", () => queue);
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/pipeline/handlers", () => handlers);
vi.mock("@/lib/jobs/schedule", () => ({ maybeScheduleInboxSync: vi.fn(async () => false) }));
vi.mock("@/lib/events", () => ({ logEvent: vi.fn(async () => {}) }));

import { tick } from "@/lib/jobs/worker";
import { TimeoutError, withTimeout } from "@/lib/util";

const never = () => new Promise<never>(() => {});
const job = { id: 1, type: "campaign.discover", attempts: 1, maxAttempts: 3, campaignId: null, payload: {} };

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of [...Object.values(queue), ...Object.values(db), ...Object.values(handlers)]) f.mockReset();
  queue.recoverStaleJobs.mockResolvedValue(undefined);
  queue.completeJob.mockResolvedValue(undefined);
  queue.failJob.mockResolvedValue(false);
  db.resetDb.mockResolvedValue(undefined);
  handlers.runJob.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("renvoie le résultat ou lève une TimeoutError", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "x")).resolves.toBe(42);
    const late = withTimeout(never(), 1000, "la requête");
    const check = expect(late).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await check;
  });
});

describe("worker : base qui ne répond plus", () => {
  it("abandonne une réservation bloquée et recrée les connexions", async () => {
    queue.claimJob.mockImplementation(never);
    const run = tick({ concurrency: 2, deadlineMs: 60_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(run).resolves.toBe(0);
    expect(db.resetDb).toHaveBeenCalled();
  });

  it("n'enregistre pas d'échec quand seule la clôture d'un job réussi est bloquée", async () => {
    queue.claimJob.mockResolvedValueOnce(job).mockResolvedValue(null);
    queue.completeJob.mockImplementation(never);
    const run = tick({ concurrency: 1 });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(run).resolves.toBe(1);
    expect(handlers.runJob).toHaveBeenCalledOnce();
    expect(queue.failJob).not.toHaveBeenCalled();
    expect(db.resetDb).toHaveBeenCalledOnce();
  });

  it("traite normalement les jobs quand la base répond", async () => {
    queue.claimJob.mockResolvedValueOnce(job).mockResolvedValueOnce({ ...job, id: 2 }).mockResolvedValue(null);
    handlers.runJob.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("boom"));
    await expect(tick({ concurrency: 1 })).resolves.toBe(2);
    expect(queue.completeJob).toHaveBeenCalledWith(1);
    expect(queue.failJob).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), "boom");
    expect(db.resetDb).not.toHaveBeenCalled();
  });
});
