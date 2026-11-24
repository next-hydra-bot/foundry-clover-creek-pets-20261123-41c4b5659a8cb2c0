import { localization } from "@repo/site-config";

export const { defaultLocale, locales } = localization;
export type SupportedLocale = (typeof locales)[number];

export const resolveSupportedLocale = (
  requestedLocale: string | undefined
): SupportedLocale =>
  locales.find((locale) => locale === requestedLocale) ?? defaultLocale;

const messageFallbacks: Readonly<Record<string, string>> = {
  "en-CA": "en-US",
  "fr-CA": "fr-FR",
};

export const messageLocale = (locale: string) =>
  messageFallbacks[locale] ?? locale;
