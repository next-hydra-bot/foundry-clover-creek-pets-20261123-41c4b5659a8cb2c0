"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/design-system/components/ui/alert-dialog";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/design-system/components/ui/dialog";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { useId, useState } from "react";

import type { ShoppingListAction } from "./action-contract";
import { ConnectedShoppingListForm } from "./form";

export function ShoppingListSettings({
  action,
  fields,
  name,
  labels,
}: {
  readonly action: ShoppingListAction;
  readonly fields: Readonly<Record<string, string>>;
  readonly name: string;
  readonly labels: {
    readonly rename: string;
    readonly name: string;
    readonly save: string;
    readonly delete: string;
    readonly confirmDelete: string;
    readonly deleteDescription: string;
    readonly renameDescription: string;
    readonly cancel: string;
    readonly pendingLabel: string;
    readonly refreshLabel: string;
    readonly savedLabel: string;
  };
}) {
  const [open, setOpen] = useState<"rename" | "delete" | null>(null);
  const inputId = useId();
  const feedback = {
    pendingLabel: labels.pendingLabel,
    refreshLabel: labels.refreshLabel,
    savedLabel: labels.savedLabel,
  };
  return (
    <div className="flex items-center gap-2">
      <Dialog
        open={open === "rename"}
        onOpenChange={(value) => setOpen(value ? "rename" : null)}
      >
        <DialogTrigger asChild>
          <Button variant="outline">{labels.rename}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.rename}</DialogTitle>
            <DialogDescription>{labels.renameDescription}</DialogDescription>
          </DialogHeader>
          <ConnectedShoppingListForm
            action={action}
            fields={{ ...fields, _tag: "Rename" }}
            label={labels.save}
            onSaved={() => setOpen(null)}
            {...feedback}
          >
            <div className="grid gap-2">
              <Label htmlFor={inputId}>{labels.name}</Label>
              <Input
                id={inputId}
                name="name"
                defaultValue={name}
                maxLength={255}
                required
              />
            </div>
          </ConnectedShoppingListForm>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={open === "delete"}
        onOpenChange={(value) => setOpen(value ? "delete" : null)}
      >
        <AlertDialogTrigger asChild>
          <Button variant="ghost" className="text-muted-foreground">
            {labels.delete}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.delete}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start justify-end gap-2">
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <ConnectedShoppingListForm
              action={action}
              fields={{ ...fields, _tag: "Delete" }}
              label={labels.confirmDelete}
              onSaved={() => setOpen(null)}
              destructive
              {...feedback}
            />
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
