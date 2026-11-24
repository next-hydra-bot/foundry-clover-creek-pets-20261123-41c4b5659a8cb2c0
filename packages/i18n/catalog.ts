import { catalogLocale, messagesByLocale } from "./messages-by-locale";

export const getMessageCatalog = (
  locale?: string
): (typeof messagesByLocale)["en-US"] =>
  messagesByLocale[catalogLocale(locale)];
