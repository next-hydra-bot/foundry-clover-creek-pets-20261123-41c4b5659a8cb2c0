"use client";

import type { AddressBookEntry } from "@repo/commerce-core/domain/address-book";
import {
  addressRegionCode,
  addressRegions,
} from "@repo/commerce-core/domain/address-regions";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { useLocale, useTranslations } from "@repo/i18n";
import { ISO_COUNTRY_CODES } from "@repo/i18n/countries";
import { useActionState, useId, useState } from "react";
import type { ReactNode } from "react";

import type {
  CustomerAccountAction,
  CustomerAccountActionResult,
} from "./action-contract";

export interface CustomerProfileValues {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export const ProfileFields = ({
  email,
  firstName,
  lastName,
}: CustomerProfileValues) => {
  const t = useTranslations("web.registration.form.fields");
  const id = useId();
  const [names, setNames] = useState({ firstName, lastName });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor={`${id}-first`}>{t("firstName.label")}</Label>
        <Input
          autoComplete="given-name"
          value={names.firstName}
          onChange={(event) => {
            setNames({ ...names, firstName: event.target.value });
          }}
          id={`${id}-first`}
          maxLength={80}
          name="firstName"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-last`}>{t("lastName.label")}</Label>
        <Input
          autoComplete="family-name"
          value={names.lastName}
          onChange={(event) => {
            setNames({ ...names, lastName: event.target.value });
          }}
          id={`${id}-last`}
          maxLength={80}
          name="lastName"
          required
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor={`${id}-email`}>{t("email.label")}</Label>
        <Input
          autoComplete="email"
          id={`${id}-email`}
          readOnly
          type="email"
          value={email}
        />
      </div>
    </div>
  );
};

export const AddressFields = ({
  address,
  reference,
}: {
  readonly address?: AddressBookEntry["address"];
  readonly reference: string;
}) => {
  const t = useTranslations("web.registration.form.fields");
  const locale = useLocale();
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const defaultCountry = locale.split("-")[1] ?? "US";
  const [country, setCountry] = useState(
    address ? (address.country ?? "") : defaultCountry
  );
  const [region, setRegion] = useState(
    addressRegionCode(address?.country ?? "", address?.region) ?? ""
  );
  const [values, setValues] = useState({
    addressLine1: address?.addressLine1 ?? "",
    addressLine2: address?.addressLine2 ?? "",
    city: address?.city ?? "",
    postalCode: address?.postalCode ?? "",
  });
  const regions = addressRegions(country);
  const selectedRegion = regions.some(({ code }) => code === region)
    ? region
    : "";
  const id = useId();
  const fields = [
    {
      autoComplete: "address-line1",
      label: t("streetAddress.label"),
      maxLength: 120,
      name: "addressLine1",
      required: true,
    },
    {
      autoComplete: "address-line2",
      label: t("addressLine2.label"),
      maxLength: 120,
      name: "addressLine2",
      required: false,
    },
    {
      autoComplete: "postal-code",
      label: t("postalCode.label"),
      maxLength: 32,
      name: "postalCode",
      required: true,
    },
    {
      autoComplete: "address-level2",
      label: t("city.label"),
      maxLength: 80,
      name: "city",
      required: true,
    },
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input name="reference" type="hidden" value={reference} />
      {/* Native Select controls reset after form Actions; submit the controlled values. */}
      <input name="country" type="hidden" value={country} />
      {fields.map((field) => (
        <div
          className={
            field.name === "addressLine1" || field.name === "addressLine2"
              ? "grid gap-2 sm:col-span-2"
              : "grid gap-2"
          }
          key={field.name}
        >
          <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
          <Input
            autoComplete={field.autoComplete}
            id={`${id}-${field.name}`}
            maxLength={field.maxLength}
            name={field.name}
            required={field.required}
            value={values[field.name]}
            onChange={(event) => {
              setValues({ ...values, [field.name]: event.target.value });
            }}
          />
        </div>
      ))}
      <div className="grid gap-2">
        <Label htmlFor={`${id}-region`}>
          {t(regions.length > 0 ? "region.requiredLabel" : "region.codeLabel")}
        </Label>
        {regions.length > 0 ? (
          <>
            <input name="region" type="hidden" value={selectedRegion} />
            <Select value={selectedRegion} onValueChange={setRegion} required>
              <SelectTrigger className="w-full" id={`${id}-region`}>
                <SelectValue placeholder={t("region.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {regions.map(({ code, label }) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <Input
            id={`${id}-region`}
            name="region"
            maxLength={80}
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
            }}
          />
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-country`}>{t("country.label")}</Label>
        <Select
          onValueChange={(country) => {
            setCountry(country);
            setRegion("");
          }}
          value={country}
          required
        >
          <SelectTrigger className="w-full" id={`${id}-country`}>
            <SelectValue placeholder={t("country.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {ISO_COUNTRY_CODES.map((code) => ({
              code,
              label: displayNames.of(code) ?? code,
            }))
              // oxlint-disable-next-line unicorn/no-array-sort -- This newly allocated list targets ES2022, which has no toSorted API.
              .sort((left, right) => left.label.localeCompare(right.label))
              .map(({ code, label }) => (
                <SelectItem key={code} value={code}>
                  {label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export const AccountForm = ({
  action,
  children,
  title,
  submitLabel,
}: {
  readonly action: CustomerAccountAction;
  readonly children: ReactNode;
  readonly title: string;
  readonly submitLabel: string;
}) => {
  const [result, formAction, pending] = useActionState<
    CustomerAccountActionResult | null,
    FormData
  >(action, null);
  const t = useTranslations("web.customerAccount");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-6">
          {result?._tag === "Failure" ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>
                {result.failure.displayMessage}
              </AlertDescription>
            </Alert>
          ) : null}
          {result?._tag === "Success" ? (
            <p role="status">{t("saved")}</p>
          ) : null}
          {children}
          <Button
            className="justify-self-start"
            disabled={pending}
            type="submit"
          >
            {pending ? t("saving") : submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
