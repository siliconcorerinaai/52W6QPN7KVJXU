"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { useIsAdmin } from "@/components/RoleContext";
import { Button } from "@/components/ui";
import { BREAKER, pct, POLICY_LABEL, SEND_POLICIES, type SendPolicy } from "@/lib/outreach/safety";
import type { SafetyOverview } from "@/lib/pipeline/safety";

/**
 * Règle d'envoi de la campagne : quelles adresses reçoivent le premier email,
 * taux de rebond, et emails mis de côté (« Envoyer quand même »).
 */
export function SendSafety({ campaignId, version, onChanged }: { campaignId: string; version: number; onChanged: () => void }) {
  const [s, setS] = useState<SafetyOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = useIsAdmin();

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/safety`);
    if (res.ok) setS((await res.json()).safety);
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function post(name: string, body: object) {
    setBusy(name);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/safety`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      setS(json.safety);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!s) return null;
  const { health } = s;
  const rateTone = !health.attempts ? "text-slate-500" : health.rate > 0.02 ? "text-amber-600" : "text-emerald-600";

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <ShieldCheck className="size-4 text-brand-600" /> Envoi aux adresses sûres
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Règle d'envoi">
          {SEND_POLICIES.map((p: SendPolicy) => (
            <button
              key={p}
              role="radio"
              aria-checked={s.policy === p}
              disabled={!!busy}
              title={POLICY_LABEL[p].detail}
              onClick={() => s.policy !== p && post(`policy-${p}`, { policy: p })}
              className={clsx(
                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                s.policy === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
              )}
            >
              {POLICY_LABEL[p].label}
              {p === "balanced" && <span className="ml-1 text-slate-400">(conseillé)</span>}
            </button>
          ))}
        </div>
        <div className={clsx("text-xs font-medium", rateTone)}>
          {health.attempts
            ? `Rebonds : ${pct(health.rate)} (${health.bounces} sur ${health.attempts} premier${health.attempts > 1 ? "s" : ""} email${health.attempts > 1 ? "s" : ""})`
            : "Rebonds : aucun envoi encore mesuré"}
        </div>
        {s.held > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-amber-700">
              {s.held} email{s.held > 1 ? "s" : ""} mis de côté
            </span>
            <Button size="sm" variant="secondary" loading={busy === "release"} onClick={() => post("release", { release: "all" })}>
              Envoyer quand même
            </Button>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {POLICY_LABEL[s.policy].detail} Si les rebonds dépassent {Math.round(BREAKER.maxRate * 100)} % (au moins {BREAKER.minBounces} sur{" "}
        {BREAKER.minSends} envois), la règle se resserre toute seule
        {s.policy === "safe" ? " et la campagne se met en pause" : ""} pour protéger votre boîte d&apos;envoi.
        {(s.pending.guess > 0 || s.pending.probable > 0) && (
          <>
            {" "}
            À contacter : {s.pending.verified} vérifiée{s.pending.verified > 1 ? "s" : ""}, {s.pending.probable} au format confirmé,{" "}
            {s.pending.guess} devinée{s.pending.guess > 1 ? "s" : ""}.
          </>
        )}
        {admin && !s.verifier && s.pending.guess + s.pending.probable > 0 && " Un service de vérification (ZeroBounce, NeverBounce, MillionVerifier) confirmerait ces adresses avant l'envoi."}
      </p>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
