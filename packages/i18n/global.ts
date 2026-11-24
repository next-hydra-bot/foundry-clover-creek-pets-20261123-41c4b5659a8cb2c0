import type { getMessageCatalog } from "./catalog";
import type { formats } from "./request";
import type { routing } from "./routing";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: ReturnType<typeof getMessageCatalog>;
    Formats: typeof formats;
  }
}
