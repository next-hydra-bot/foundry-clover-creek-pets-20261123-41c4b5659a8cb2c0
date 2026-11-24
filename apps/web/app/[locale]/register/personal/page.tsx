import { getAuthRoutes, withAuth } from "@repo/auth/server";
import { CustomerRegistrationPage } from "@repo/commerce-b2c/registration";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { notFound } from "next/navigation";

export default async function RegistrationRoute({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Match the existing locale route contract.
  setRequestLocale(locale);
  const [content] = [
    CustomerRegistrationPage({
      locale,

      auth: { readSession: withAuth, routes: getAuthRoutes },
    }),
  ] as const;
  return content;
}
