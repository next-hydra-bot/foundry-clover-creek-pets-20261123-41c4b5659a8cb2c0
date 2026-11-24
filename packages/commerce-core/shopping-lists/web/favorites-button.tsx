"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { useState, useTransition } from "react";

import { useProductPurchaseSelection } from "../../product/product-detail-client";
import type {
  ShoppingListAction,
  ShoppingListActionResult,
} from "./action-contract";
import { saveShoppingList } from "./actions";
import { ConnectedShoppingListForm } from "./form";

export interface FavoritesLabels {
  readonly add: string;
  readonly remove: string;
  readonly saving: string;
  readonly chooseVariant: string;
  readonly favorites: string;
  readonly otherList: string;
  readonly save: string;
  readonly saved: string;
  readonly create: string;
  readonly name: string;
  readonly refresh: string;
}
export interface ListChoice {
  readonly id: string;
  readonly revision: string;
  readonly name: string;
}
interface FavoritesProps {
  readonly fields: Readonly<Record<string, string>>;
  readonly initialVariantIds: readonly string[];
  readonly labels: FavoritesLabels;
}

/** Explicit props/actions keep selection feedback testable without a provider or router. */
export function FavoritesControl({
  fields,
  initialVariantIds,
  labels,
  variantId,
  action,
}: FavoritesProps & {
  readonly variantId: string | undefined;
  readonly action: ShoppingListAction;
}) {
  const [saved, setSaved] = useState(() => new Set(initialVariantIds));
  const [feedback, setFeedback] = useState<ShoppingListActionResult | null>(
    null
  );
  const [pending, start] = useTransition();
  const selected = variantId !== undefined && saved.has(variantId);
  const toggle = () => {
    if (!variantId) {
      return;
    }
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      data.set(key, value);
    }
    data.set("_tag", "Favorite");
    data.set("name", labels.favorites);
    data.set("variantId", variantId);
    data.set("saved", selected ? "false" : "true");
    start(async () => {
      const result = await action(data);
      setFeedback(result);
      if (result._tag === "Success" && result.success.favorite) {
        const { favorite } = result.success;
        setSaved((current) => {
          const next = new Set(current);
          if (favorite.saved) {
            next.add(favorite.variantId);
          } else {
            next.delete(favorite.variantId);
          }
          return next;
        });
      }
    });
  };
  let label = selected ? labels.remove : labels.add;
  if (pending) {
    label = labels.saving;
  }
  if (!variantId) {
    label = labels.chooseVariant;
  }
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        aria-pressed={selected}
        disabled={pending || !variantId}
        onClick={toggle}
      >
        <span aria-hidden="true">{selected ? "♥" : "♡"}</span>
        {label}
      </Button>
      {feedback ? (
        <p
          role={feedback._tag === "Success" ? "status" : "alert"}
          className="text-sm"
        >
          {feedback._tag === "Success"
            ? labels.saved
            : feedback.failure.displayMessage}
        </p>
      ) : null}
    </div>
  );
}

export function FavoritesButton(props: FavoritesProps) {
  const { variantId } = useProductPurchaseSelection();
  return (
    <FavoritesControl
      {...props}
      variantId={variantId}
      action={saveShoppingList}
    />
  );
}

export function ProductListPicker({
  fields,
  labels,
  choices,
}: {
  readonly fields: Readonly<Record<string, string>>;
  readonly labels: FavoritesLabels;
  readonly choices: readonly ListChoice[];
}) {
  const { variantId, quantity } = useProductPurchaseSelection();
  const [selection, setSelection] = useState(choices[0]?.id ?? "");
  const list = choices.find((choice) => choice.id === selection) ?? choices[0];
  if (!variantId) {
    return null;
  }
  const item = { ...fields, quantity: String(quantity), variantId };
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {labels.otherList}
      </summary>
      <div className="mt-3 grid gap-5">
        {list ? (
          <div className="grid gap-2">
            <select
              aria-label={labels.otherList}
              value={list.id}
              onChange={(event) => {
                setSelection(event.target.value);
              }}
              className="rounded-md border bg-background px-3 py-2"
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
            <ConnectedShoppingListForm
              key={`${list.id}:${list.revision}`}
              action={saveShoppingList}
              fields={{
                ...item,
                _tag: "AddItem",
                expectedRevision: list.revision,
                id: list.id,
              }}
              label={labels.save}
              pendingLabel={labels.saving}
              refreshLabel={labels.refresh}
              savedLabel={labels.saved}
            />
          </div>
        ) : null}
        <ConnectedShoppingListForm
          action={saveShoppingList}
          fields={{ ...item, _tag: "CreateWithItem" }}
          label={labels.create}
          pendingLabel={labels.saving}
          refreshLabel={labels.refresh}
          savedLabel={labels.saved}
        >
          <label className="grid gap-1">
            {labels.name}
            <Input name="name" maxLength={255} required />
          </label>
        </ConnectedShoppingListForm>
      </div>
    </details>
  );
}
