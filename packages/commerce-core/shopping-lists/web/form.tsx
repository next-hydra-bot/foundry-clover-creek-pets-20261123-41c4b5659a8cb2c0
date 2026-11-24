"use client";

import { Button } from "@repo/design-system/components/ui/button";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import type { ComponentProps, ReactNode } from "react";

import type {
  ShoppingListAction,
  ShoppingListActionResult,
} from "./action-contract";

interface FormProps {
  readonly action: ShoppingListAction;
  readonly fields: Readonly<Record<string, string>>;
  readonly label: string;
  readonly pendingLabel: string;
  readonly refreshLabel: string;
  readonly savedLabel: string;
  readonly children?: ReactNode;
  readonly destructive?: boolean;
  readonly layout?: "stack" | "inline";
  readonly buttonVariant?: ComponentProps<typeof Button>["variant"];
}

export function ShoppingListForm({
  action,
  fields,
  label,
  pendingLabel,
  refreshLabel,
  savedLabel,
  children,
  destructive = false,
  layout = "stack",
  buttonVariant,
  onSaved,
  onRefresh,
}: FormProps & {
  readonly onSaved: (destination?: string) => void;
  readonly onRefresh: () => void;
}) {
  const [result, submit, pending] = useActionState(
    async (_previous: ShoppingListActionResult | null, form: FormData) => {
      const next = await action(form);
      if (next._tag === "Success") {
        onSaved(next.success.destination);
      }
      return next;
    },
    null
  );
  return (
    <form action={submit} className="grid gap-3">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      <fieldset
        disabled={pending}
        className={
          layout === "inline"
            ? "flex min-w-0 flex-wrap items-end gap-2"
            : "grid gap-3"
        }
      >
        {children}
        <Button
          type="submit"
          variant={buttonVariant ?? (destructive ? "destructive" : "default")}
          size="default"
          className={layout === "inline" ? "shrink-0" : "justify-self-end"}
          disabled={pending}
        >
          {pending ? pendingLabel : label}
        </Button>
      </fieldset>
      {result ? (
        <p
          role={result._tag === "Success" ? "status" : "alert"}
          className="text-sm"
        >
          {result._tag === "Success"
            ? savedLabel
            : result.failure.displayMessage}
        </p>
      ) : null}
      {result?._tag === "Failure" ? (
        <Button type="button" variant="outline" onClick={onRefresh}>
          {refreshLabel}
        </Button>
      ) : null}
    </form>
  );
}

/** The form owns submission feedback; this small binding owns Next navigation. */
export function ConnectedShoppingListForm({
  onSaved,
  ...props
}: FormProps & { readonly onSaved?: () => void }) {
  const router = useRouter();
  return (
    <ShoppingListForm
      {...props}
      onSaved={(destination) => {
        onSaved?.();
        if (destination) {
          // SAFETY: The package-owned action constructs this locale-prefixed application path.
          router.push(destination as Route);
        }
        router.refresh();
      }}
      onRefresh={() => {
        router.refresh();
      }}
    />
  );
}
