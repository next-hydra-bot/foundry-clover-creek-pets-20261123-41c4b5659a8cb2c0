"use client";

import type { AddressBookEntry } from "@repo/commerce-core/domain/address-book";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/design-system/components/ui/alert-dialog";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/design-system/components/ui/dialog";
import { useLocale, useTranslations } from "@repo/i18n";
import { useActionState, useState } from "react";

import { AccountForm, AddressFields, ProfileFields } from "./account-form";
import type { CustomerProfileValues } from "./account-form";
import type {
  CustomerAccountAction,
  CustomerAccountActionResult,
} from "./action-contract";

export const CustomerProfileForm = ({
  action,
  profile,
}: {
  readonly action: CustomerAccountAction;
  readonly profile: CustomerProfileValues;
}) => {
  const t = useTranslations("web.customerAccount");
  return (
    <AccountForm
      action={action}
      submitLabel={t("saveProfile")}
      title={t("profileTitle")}
    >
      <ProfileFields {...profile} />
    </AccountForm>
  );
};

type SavedAddressDetails = Pick<
  AddressBookEntry,
  "address" | "reference" | "defaultShipping" | "defaultBilling"
>;

const AddressChangeForm = ({
  action,
  address,
  operation,
  reference,
  onSaved,
}: {
  readonly action: CustomerAccountAction;
  readonly address?: SavedAddressDetails["address"];
  readonly operation: "add" | "edit" | "remove" | "setDefault";
  readonly reference: string;
  readonly onSaved?: () => void;
}) => {
  const t = useTranslations("web.customerAccount");
  const [result, submit, pending] = useActionState<
    CustomerAccountActionResult | null,
    FormData
  >(async (previous, form) => {
    const outcome = await action(previous, form);
    if (outcome._tag === "Success") {
      onSaved?.();
    }
    return outcome;
  }, null);
  const failure = result?._tag === "Failure" ? result.failure : undefined;
  const needsRefresh = failure?.error.recovery === "refresh";
  const isEditor = operation === "add" || operation === "edit";
  const { label, variant } = (
    {
      add: { label: t("saveAddress"), variant: "default" },
      edit: { label: t("saveAddress"), variant: "default" },
      remove: { label: t("removeAddress"), variant: "destructive" },
      setDefault: { label: t("setDefaultAddress"), variant: "outline" },
    } as const
  )[operation];
  return (
    <form action={submit} className="grid gap-3">
      {operation === "add" ? null : (
        <input type="hidden" name="operation" value={operation} />
      )}
      {isEditor ? (
        <AddressFields address={address} reference={reference} />
      ) : (
        <input type="hidden" name="reference" value={reference} />
      )}
      {failure ? (
        <p role="alert" className="text-destructive text-sm">
          {failure.displayMessage}
        </p>
      ) : null}
      <div
        className={operation === "setDefault" ? "" : "flex justify-end gap-2"}
      >
        {isEditor ? (
          <DialogClose asChild>
            <Button disabled={pending} type="button" variant="outline">
              {t("cancelAddressChange")}
            </Button>
          </DialogClose>
        ) : null}
        {operation === "remove" ? (
          <AlertDialogCancel disabled={pending}>
            {t("cancelAddressChange")}
          </AlertDialogCancel>
        ) : null}
        <Button
          disabled={pending || needsRefresh}
          size={operation === "setDefault" ? "sm" : "default"}
          type="submit"
          variant={variant}
        >
          {pending ? t("saving") : label}
        </Button>
      </div>
    </form>
  );
};

export function CustomerAddressDialog({
  action,
  address,
  reference,
}: {
  readonly action: CustomerAccountAction;
  readonly address?: SavedAddressDetails["address"];
  readonly reference: string;
}) {
  const t = useTranslations("web.customerAccount");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t(address ? "editAddress" : "addAddress")}
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {t(address ? "editAddressTitle" : "addAddress")}
          </DialogTitle>
        </DialogHeader>
        <AddressChangeForm
          action={action}
          address={address}
          operation={address ? "edit" : "add"}
          reference={reference}
          onSaved={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function SavedAddressCard({
  action,
  entry,
}: {
  readonly action: CustomerAccountAction;
  readonly entry: SavedAddressDetails;
}) {
  const t = useTranslations("web.customerAccount");
  const locale = useLocale();
  const [removeOpen, setRemoveOpen] = useState(false);
  const { address, defaultBilling, defaultShipping } = entry;
  const isDefault = defaultBilling && defaultShipping;
  const defaultLabel = defaultShipping
    ? t(defaultBilling ? "defaultAddress" : "defaultShippingAddress")
    : t("defaultBillingAddress");
  const country = address.country
    ? new Intl.DisplayNames([locale], { type: "region" }).of(address.country)
    : undefined;
  return (
    <div className="grid h-full content-start gap-4 rounded-md border p-4">
      <address className="grid gap-0.5 text-sm not-italic">
        <p className="font-medium">{address.addressLine1}</p>
        {address.addressLine2 ? <p>{address.addressLine2}</p> : null}
        <p>
          {[address.city, address.region, address.postalCode]
            .filter(Boolean)
            .join(", ")}
        </p>
        {country ? <p>{country}</p> : null}
      </address>
      {defaultShipping || defaultBilling ? (
        <Badge variant="secondary">{defaultLabel}</Badge>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        <CustomerAddressDialog
          action={action}
          address={address}
          reference={entry.reference}
        />
        {isDefault ? null : (
          <AddressChangeForm
            action={action}
            operation="setDefault"
            reference={entry.reference}
          />
        )}
        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost">
              {t("removeAddress")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("removeAddressTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("removeAddressDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AddressChangeForm
              action={action}
              operation="remove"
              reference={entry.reference}
              onSaved={() => {
                setRemoveOpen(false);
              }}
            />
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
