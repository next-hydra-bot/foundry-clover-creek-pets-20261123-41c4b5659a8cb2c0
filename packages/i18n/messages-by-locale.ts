import { defaultLocale, messageLocale } from "./config";
import deDE from "./messages/de-DE.json" with { type: "json" };
import enGB from "./messages/en-GB.json" with { type: "json" };
import enUS from "./messages/en-US.json" with { type: "json" };
import esES from "./messages/es-ES.json" with { type: "json" };
import frFR from "./messages/fr-FR.json" with { type: "json" };
import itIT from "./messages/it-IT.json" with { type: "json" };
import nlNL from "./messages/nl-NL.json" with { type: "json" };
import ptPT from "./messages/pt-PT.json" with { type: "json" };

const catalogs = {
  "de-DE": deDE,
  "en-GB": enGB,
  "en-US": enUS,
  "es-ES": esES,
  "fr-FR": frFR,
  "it-IT": itIT,
  "nl-NL": nlNL,
  "pt-PT": ptPT,
};

export type CatalogLocale = keyof typeof catalogs;
export const messagesByLocale: Readonly<Record<CatalogLocale, typeof enUS>> =
  catalogs;

function isCatalogLocale(locale: string): locale is CatalogLocale {
  return Object.hasOwn(catalogs, locale);
}

export function catalogLocale(requestedLocale: string = defaultLocale) {
  const locale = messageLocale(requestedLocale);
  if (isCatalogLocale(locale)) {
    return locale;
  }

  const fallback = messageLocale(defaultLocale);
  if (isCatalogLocale(fallback)) {
    return fallback;
  }
  throw new Error(`Missing default message catalog for ${defaultLocale}`);
}
