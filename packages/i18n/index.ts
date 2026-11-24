export type { MessageKeys, Messages, NestedKeyOf } from "next-intl";
export {
  createTranslator,
  hasLocale,
  type Locale,
  NextIntlClientProvider,
  useFormatter,
  useLocale,
  useTranslations,
} from "next-intl";
export { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import "./global";
