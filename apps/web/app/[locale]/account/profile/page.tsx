import { withAuth, getAuthRoutes } from "@repo/auth/server";
import { CustomerAccountPage as B2CAccountPage } from "@repo/commerce-b2c/customer-account";
import { CustomerProfileSkeleton } from "@repo/commerce-b2c/customer-account/loading";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { notFound } from "next/navigation";
import { Suspense } from "react";

interface AccountRouteProps {
  readonly params: Promise<{ readonly locale: string }>;
}

export default async function Profile({ params }: AccountRouteProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Match the workspace's current locale route contract.
  setRequestLocale(locale);
  const auth = { readSession: withAuth, routes: getAuthRoutes };
  return (
    <Suspense fallback={<CustomerProfileSkeleton />}>
      <B2CAccountPage locale={locale} auth={auth} />
    </Suspense>
  );
}
