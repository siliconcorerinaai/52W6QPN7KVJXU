"use client";

import { useState } from "react";
import { X } from "lucide-react";

/** Liste de valeurs éditable sous forme de puces. */
export function ChipsEditor({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="text-brand-400 hover:text-brand-700" aria-label={`Retirer ${v}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={values.length ? "" : placeholder ?? "Ajouter…"}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm focus:outline-none"
      />
    </div>
  );
}
