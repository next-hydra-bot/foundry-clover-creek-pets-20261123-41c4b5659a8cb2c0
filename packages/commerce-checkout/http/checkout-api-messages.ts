import { getMessageCatalog } from "@repo/i18n/catalog";
import { resolveSupportedLocale } from "@repo/i18n/config";

import { checkoutPublicErrorMessage } from "../checkout/public-error-messages";
import type { CheckoutPublicErrorCode } from "../checkout/public-error-messages";

export type CheckoutApiErrorCode =
  | CheckoutPublicErrorCode
  | "checkout.badRequest";

export const checkoutApiErrorMessage = (
  locale: string | undefined,
  code: CheckoutApiErrorCode
) =>
  code === "checkout.badRequest"
    ? getMessageCatalog(resolveSupportedLocale(locale)).web.checkout.errors
        .badRequest
    : checkoutPublicErrorMessage(locale, code);
