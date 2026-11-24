import { getAuthRoutes, withAuth } from "@repo/auth/server";
import { ShoppingListsSkeleton } from "@repo/commerce-core/shopping-lists/web/loading";
import { ShoppingListsPage } from "@repo/commerce-core/shopping-lists/web/pages";
import type { ShoppingListSearch } from "@repo/commerce-core/shopping-lists/web/pages";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

async function Screen({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id?: string }>;
  readonly searchParams: Promise<ShoppingListSearch>;
}) {
  await connection();
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!hasLocale(routing.locales, locale)) notFound();
  // oxlint-disable-next-line typescript/no-deprecated -- Uses the current locale route contract.
  setRequestLocale(locale);
  const auth = { readSession: withAuth, routes: getAuthRoutes };
  const session = await auth.readSession();
  if (!session.user) {
    const routes = await auth.routes();
    // SAFETY: The selected authentication provider owns its sign-in destination.
    redirect(routes.signInHref as Route);
  }
  return (
    <ShoppingListsPage locale={locale} {...(id ? { id } : {})} query={query} />
  );
}

export default function ShoppingLists(props: Parameters<typeof Screen>[0]) {
  return (
    <Suspense {...{ fallback: <ShoppingListsSkeleton /> }}>
      <Screen {...props} />
    </Suspense>
  );
}
