"use client";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { useRouter } from "next/navigation";
import { useActionState, useId } from "react";

import type { FulfillmentAction, FulfillmentActionResult } from "./actions";

const initialState: FulfillmentActionResult = { message: "", ok: false };
export function FulfillmentQuantityForm({
  action,
  fields,
  lines,
  operation,
}: {
  readonly action: FulfillmentAction;
  readonly fields: Readonly<Record<string, string>>;
  readonly lines: readonly {
    readonly id: string;
    readonly name: string;
    readonly remaining: number;
  }[];
  readonly operation: "pack" | "ship";
}) {
  const router = useRouter();
  const formId = useId();
  const label = operation === "pack" ? "Pack delivery" : "Ship parcel";
  const [state, submit, pending] = useActionState(
    async (_previous: FulfillmentActionResult, form: FormData) =>
      await action(form),
    initialState
  );
  return (
    <form action={submit} className="grid gap-3 rounded border p-4">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      {lines
        .filter((line) => line.remaining > 0)
        .map((line) => (
          <label
            className="flex items-center justify-between gap-4"
            key={line.id}
          >
            <span>
              {line.name} · {line.remaining} remaining
            </span>
            <Input
              aria-label={`Quantity for ${line.name}`}
              className="w-24"
              defaultValue="0"
              disabled={pending}
              max={line.remaining}
              min="0"
              name={`quantity:${line.id}`}
              step="1"
              type="number"
            />
          </label>
        ))}
      {operation === "ship" && (
        <div className="flex gap-3">
          <label htmlFor={`${formId}-carrier`}>
            Carrier
            <Input disabled={pending} id={`${formId}-carrier`} name="carrier" />
          </label>
          <label htmlFor={`${formId}-tracking`}>
            Tracking number
            <Input
              disabled={pending}
              id={`${formId}-tracking`}
              name="trackingNumber"
            />
          </label>
        </div>
      )}
      <Button disabled={pending} type="submit">
        {pending ? "Saving…" : label}
      </Button>
      {state.message && (
        <p role={state.ok ? "status" : "alert"}>{state.message}</p>
      )}
      {!state.ok && state.message && (
        <Button
          onClick={() => {
            router.refresh();
          }}
          type="button"
          variant="outline"
        >
          Refresh Order
        </Button>
      )}
    </form>
  );
}
