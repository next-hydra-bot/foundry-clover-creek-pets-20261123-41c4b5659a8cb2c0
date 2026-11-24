import { CountryCode } from "@repo/commerce-core/domain/checkout";
import type { CheckoutViolation } from "@repo/commerce-core/domain/checkout";
import type { CommerceLocale } from "@repo/commerce-core/store";
import { createTranslator } from "@repo/i18n";
import { getMessageCatalog } from "@repo/i18n/catalog";
import { messageLocale, resolveSupportedLocale } from "@repo/i18n/config";
import { catalogLocale } from "@repo/i18n/messages-by-locale";
import type { Locale } from "@repo/i18n/types";
import { Option, Schema } from "effect";

export function createCheckoutTranslator(requestedLocale: string) {
  const locale =
    messageLocale(requestedLocale) === catalogLocale(requestedLocale)
      ? requestedLocale
      : resolveSupportedLocale(requestedLocale);
  return createTranslator({
    // A catalog can support a formatting locale that the storefront does not route.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    locale: locale as Locale,
    messages: getMessageCatalog(requestedLocale).web.checkout,
  });
}

export const localizedCountryName = (
  country: string | number | undefined,
  locale: string,
  fallback: string
) => {
  const countryCode = Option.getOrUndefined(
    Schema.decodeUnknownOption(CountryCode)(country)
  );

  if (countryCode === undefined) {
    return fallback;
  }

  return (
    new Intl.DisplayNames([locale], { type: "region" }).of(countryCode) ??
    countryCode
  );
};

export const checkoutViolationMessage = (
  locale: CommerceLocale,
  violation: CheckoutViolation
) => {
  const t = createCheckoutTranslator(locale);

  switch (violation.code) {
    case "tax.unavailable": {
      return t("violations.taxUnavailable");
    }
    case "shipping.country.unavailable": {
      const countryName = localizedCountryName(
        violation.parameters?.country,
        locale,
        t("violations.unknownCountry")
      );

      return t("violations.shippingCountryUnavailable", {
        country: countryName,
      });
    }
    case "MAX_GUEST_TOTAL_ITEMS_EXCEEDED": {
      const excessQuantity = violation.parameters?.excessQuantity;
      const maxQuantity = violation.parameters?.maxQuantity;

      if (
        !Schema.is(Schema.Number)(excessQuantity) ||
        !Schema.is(Schema.Number)(maxQuantity)
      ) {
        return t("violations.generic");
      }

      return t("violations.guestItemLimit", {
        excessQuantity,
        maxQuantity,
      });
    }
    case "INCOMPATIBLE_CART_ITEMS": {
      return t("violations.incompatibleCartItems");
    }
    case "shipping.region.unsupported":
    case "SHIPPING_ADDRESS_RESTRICTED": {
      return t("violations.shippingAddressRestricted");
    }
    case "POLICY_ERROR": {
      return t("violations.policyUnavailable");
    }
    default: {
      return t("violations.generic");
    }
  }
};
