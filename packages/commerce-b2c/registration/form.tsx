"use client";

import { useTranslations } from "@repo/i18n";

import {
  AccountForm,
  AddressFields,
  ProfileFields,
} from "../customer-account/account-form";
import type { CustomerProfileValues } from "../customer-account/account-form";
import type { CustomerAccountAction } from "../customer-account/action-contract";

export const CustomerRegistrationForm = ({
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
      submitLabel={t("register")}
      title={t("registrationTitle")}
    >
      <ProfileFields {...profile} />
      <AddressFields reference="personal-registration" />
      <p className="text-muted-foreground text-sm">
        {t("registrationDescription")}
      </p>
    </AccountForm>
  );
};
