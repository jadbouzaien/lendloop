"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/validators";
import { todayIso } from "@/lib/format";
import { useRun } from "@/lib/useRun";
import { Button, ErrorText, Field, inputClass } from "./ui";

export function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: (sent: boolean) => void }) {
  const today = todayIso();
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [message, setMessage] = useState("");
  const request = useMutation(api.loans.request);
  const { run, pending, error } = useRun();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() =>
      request({ toolId, startDate, endDate, message: message.trim() ? message : undefined }),
    );
    if (ok) onDone(true);
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-t border-line pt-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input
            type="date"
            className={inputClass}
            value={startDate}
            min={today}
            onChange={(e) => {
              setStart(e.target.value);
              if (endDate < e.target.value) setEnd(e.target.value);
            }}
            required
          />
        </Field>
        <Field label="Until">
          <input type="date" className={inputClass} value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
      </div>
      <Field label="Note to the lender (optional)" hint="Only the lender sees this. It is not sent to any automation.">
        <input
          className={inputClass}
          value={message}
          maxLength={LIMITS.requestMessage.max}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Hanging shelves this weekend!"
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}
