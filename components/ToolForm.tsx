"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, LIMITS, type Category, type Condition } from "@/convex/lib/validators";
import { useRun } from "@/lib/useRun";
import { Button, ErrorText, Field, inputClass } from "./ui";

export type ToolDraft = { name: string; category: Category; condition: Condition; description: string };

const EMPTY: ToolDraft = { name: "", category: "power-tools", condition: "good", description: "" };

/** Create or edit a listing. Limits mirror the server, which re-validates everything. */
export function ToolForm({
  toolId,
  initial = EMPTY,
  onDone,
}: {
  toolId?: Id<"tools">;
  initial?: ToolDraft;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<ToolDraft>(initial);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const { run, pending, error } = useRun();

  const set = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => (toolId ? update({ toolId, ...draft }) : create(draft)));
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name">
        <input
          className={inputClass}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          required
          minLength={LIMITS.toolName.min}
          maxLength={LIMITS.toolName.max}
          placeholder="e.g. Cordless drill"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          <select className={inputClass} value={draft.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select className={inputClass} value={draft.condition} onChange={(e) => set("condition", e.target.value as Condition)}>
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Short description" hint={`${draft.description.length}/${LIMITS.description.max}`}>
        <textarea
          className={`${inputClass} min-h-20`}
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={LIMITS.description.max}
          placeholder="Anything a borrower should know: accessories, quirks, pickup tips…"
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : toolId ? "Save changes" : "List tool"}
        </Button>
      </div>
    </form>
  );
}
