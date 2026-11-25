"use client";

import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input } from "@/components/ui";

type Account = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  disabled: boolean;
  monthlyCompanyLimit: number;
  createdAt: string;
  lastLoginAt: string | null;
  campaigns: number;
  companiesThisMonth: number;
  costThisMonth: number;
};

const date = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

/** Comptes clients : usage du mois, limite mensuelle, activation (administration). */
export function AccountsCard() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Chargement impossible");
    setAccounts(data.users);
    setLimits(Object.fromEntries((data.users as Account[]).map((a) => [a.id, String(a.monthlyCompanyLimit)])));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Modification impossible");
    load();
  }

  const totalCost = accounts?.reduce((s, a) => s + a.costThisMonth, 0) ?? 0;

  return (
    <Card>
      <CardHeader
        title="Comptes clients"
        subtitle={accounts ? `${accounts.length} compte(s) · coût IA du mois : ${totalCost.toFixed(2)} $ · limite = entreprises analysées par mois (0 = illimité)` : undefined}
        icon={<Users className="size-4" />}
      />
      {error && <p className="border-b border-slate-100 px-5 py-2 text-sm text-red-600">{error}</p>}
      {!accounts ? (
        <p className="p-5 text-sm text-slate-400">Chargement…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Compte</th>
                <th className="px-3 py-2 font-medium">Inscrit</th>
                <th className="px-3 py-2 font-medium">Campagnes</th>
                <th className="px-3 py-2 font-medium">Ce mois</th>
                <th className="px-3 py-2 font-medium">Coût du mois</th>
                <th className="px-3 py-2 font-medium">Limite</th>
                <th className="px-5 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((a) => (
                <tr key={a.id} className={a.disabled ? "opacity-50" : undefined}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-slate-900">{a.name || a.email}</div>
                    <div className="text-xs text-slate-500">
                      {a.name ? a.email : null} {a.role === "admin" && <Badge tone="brand">admin</Badge>} {a.disabled && <Badge tone="red">désactivé</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{date(a.createdAt)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{a.campaigns}</td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {a.companiesThisMonth}
                    {a.role !== "admin" && a.monthlyCompanyLimit > 0 ? ` / ${a.monthlyCompanyLimit}` : ""}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{a.costThisMonth.toFixed(2)} $</td>
                  <td className="px-3 py-2.5">
                    {a.role === "admin" ? (
                      <span className="text-xs text-slate-400">illimitée</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-20"
                          value={limits[a.id] ?? ""}
                          onChange={(e) => setLimits((l) => ({ ...l, [a.id]: e.target.value }))}
                        />
                        {limits[a.id] !== String(a.monthlyCompanyLimit) && (
                          <Button size="sm" variant="secondary" onClick={() => patch(a.id, { monthlyCompanyLimit: Number(limits[a.id] || 0) })}>
                            OK
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {a.role !== "admin" && (
                      <Button size="sm" variant="ghost" onClick={() => patch(a.id, { disabled: !a.disabled })}>
                        {a.disabled ? "Réactiver" : "Désactiver"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
