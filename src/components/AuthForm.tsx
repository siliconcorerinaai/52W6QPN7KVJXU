"use client";

import { useState } from "react";
import Link from "next/link";
import { Radar } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { BRAND } from "@/lib/brand";

/** Formulaire de connexion ou d'inscription. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup ? { email, name, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Une erreur est survenue.");
      const next = new URLSearchParams(window.location.search).get("next");
      // Uniquement un chemin interne (pas de redirection vers un autre site).
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow">
            <Radar className="size-5" />
          </span>
          <span className="text-xl font-semibold tracking-tight text-slate-900">{BRAND.name}</span>
        </Link>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{signup ? "Créer votre compte" : "Connexion"}</h1>
            <p className="text-sm text-slate-500">{signup ? "Trouvez vos premiers clients en quelques minutes." : "Heureux de vous revoir."}</p>
          </div>
          {signup && (
            <div>
              <Label>Nom</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Marie Dupont" />
            </div>
          )}
          <div>
            <Label>Email professionnel</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="vous@entreprise.fr" />
          </div>
          <div>
            <Label hint={signup ? "10 caractères minimum" : undefined}>Mot de passe</Label>
            <Input
              type="password"
              required
              minLength={signup ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? "new-password" : "current-password"}
            />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" loading={busy} className="w-full">
            {signup ? "Créer mon compte" : "Se connecter"}
          </Button>
          <p className="text-center text-sm text-slate-500">
            {signup ? (
              <>
                Déjà un compte ?{" "}
                <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
                  Se connecter
                </Link>
              </>
            ) : (
              <>
                Pas encore de compte ?{" "}
                <Link href="/signup" className="font-medium text-brand-600 hover:text-brand-700">
                  Créer un compte
                </Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
