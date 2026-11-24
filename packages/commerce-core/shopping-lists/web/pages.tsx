import { NextCommerce } from "@repo/commerce-core/shopping-lists/web/bindings";
import { resolveShoppingListBuyer } from "@repo/commerce-core/shopping-lists/web/buyer";
import { CustomerAreaContent } from "@repo/design-system/components/layout/customer-area";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { Effect, Option, Schema } from "effect";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CommerceRequestContextNotFound } from "../../domain/commerce-request-context";
import { ShoppingListId } from "../../domain/shopping-list";
import type { ShoppingList } from "../../domain/shopping-list";
import { ShoppingLists } from "../../services/shopping-lists";
import { saveShoppingList } from "./actions";
import { ConnectedShoppingListForm as ShoppingListForm } from "./form";
import { ShoppingListItems } from "./items";
import { ShoppingListRowsSkeleton } from "./loading";
import { ShoppingListSettings } from "./settings";

export type ShoppingListSearch = Readonly<
  Record<string, string | string[] | undefined>
>;

const messages = async (locale: Locale) =>
  await getTranslations({ locale, namespace: "web.shoppingLists" });
type Text = Awaited<ReturnType<typeof messages>>;
const selectionSchema = Schema.Struct({
  cursor: Schema.optional(Schema.NonEmptyString),
  ownership: Schema.optional(Schema.Literals(["mine", "others", "all"])),
});
export const shoppingListHref = (
  locale: Locale,
  id?: string,
  query?: URLSearchParams
) => {
  const suffix = (query?.size ?? 0) > 0 ? `?${query}` : "";
  // SAFETY: The route prefix is authored here; opaque IDs and query values are URL-encoded.
  return `/${locale}/account/shopping-lists${id ? `/${encodeURIComponent(id)}` : ""}${suffix}` as Route;
};
export const shoppingListName = (
  name: Readonly<Record<string, string>>,
  locale: string
) =>
  name[locale] ??
  name[locale.split("-")[0] ?? "en"] ??
  Object.values(name)[0] ??
  "";

const formLabels = (t: Text) => ({
  pendingLabel: t("saving"),
  refreshLabel: t("refresh"),
  savedLabel: t("saved"),
});
const targetFields = (list: ShoppingList) => ({
  expectedRevision: list.revision,
  id: list.id,
});

export async function ShoppingListsPage({
  locale,
  id,
  query,
}: {
  readonly locale: Locale;
  readonly id?: string;
  readonly query: ShoppingListSearch;
}) {
  const t = await messages(locale);
  const parsed = Schema.decodeUnknownOption(selectionSchema)(query);
  if (Option.isNone(parsed)) {
    return (
      <CustomerAreaContent title={t("title")} description={t("description")}>
        <p role="alert">{t("invalidInput")}</p>
        <Link href={shoppingListHref(locale)}>{t("firstPage")}</Link>
      </CustomerAreaContent>
    );
  }
  const selection = parsed.value;
  const ownership = selection.ownership ?? "mine";
  const { cursor } = selection;
  const result = await NextCommerce.runPromise(
    Effect.gen(function* () {
      const context = yield* resolveShoppingListBuyer(locale);
      const principal = context.buyer;
      if (!principal) {
        return yield* new CommerceRequestContextNotFound({
          reason: "noPrincipal",
          message: "Sign in to manage shopping lists.",
        });
      }
      const lists = yield* ShoppingLists;
      const scope = {
        businessUnitId: principal.businessUnit?.id ?? "",
        authUserId: principal.authUserId,
        locale,
        storeKey: context.store.storeKey,
      };
      if (id !== undefined) {
        const target = {
          id: yield* Schema.decodeUnknownEffect(ShoppingListId)(id),
          storeKey: scope.storeKey,
        };
        const list = yield* lists.get(principal, target);
        return { list, page: null, scope };
      }
      const page = yield* lists.list(principal, {
        cursor,
        limit: 20,
        ownership,
        storeKey: scope.storeKey,
      });
      return { list: null, page, scope };
    }).pipe(
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catch((error) => Effect.succeed({ error, ok: false as const }))
    )
  );
  if (!result.ok) {
    const reason =
      result.error._tag === "ShoppingListFailure"
        ? result.error.reason
        : "unavailable";
    return (
      <CustomerAreaContent title={t("title")} description={t("description")}>
        <p role="alert">
          {reason === "accessDenied" ? t("accessDenied") : t("unavailable")}
        </p>
        <Link href={shoppingListHref(locale)}>{t("firstPage")}</Link>
        <p>
          <Link href={`/${locale}/account`}>{t("account")}</Link>
        </p>
      </CustomerAreaContent>
    );
  }
  const { scope, list: found, page } = result.value;
  if (found && Option.isNone(found)) {
    notFound();
  }
  const list = found && Option.isSome(found) ? found.value : null;
  const fields = { ...scope };
  const name = list ? shoppingListName(list.name, locale) : t("title");
  return (
    <CustomerAreaContent title={name} description={t("description")}>
      {list ? (
        <div
          className="grid gap-6"
          key={`${scope.storeKey}:${scope.businessUnitId}:${list.id}`}
        >
          <section className="grid gap-4" aria-label={t("items")}>
            <div className="flex min-h-9 items-center justify-between gap-3">
              <h2 className="font-semibold text-lg">{t("items")}</h2>
              {list.purpose === "shopping" ? (
                <ShoppingListSettings
                  action={saveShoppingList}
                  fields={{ ...fields, ...targetFields(list) }}
                  name={name}
                  labels={{
                    rename: t("editName"),
                    name: t("name"),
                    save: t("rename"),
                    delete: t("delete"),
                    confirmDelete: t("confirmDelete"),
                    deleteDescription: t("deleteDescription"),
                    renameDescription: t("renameDescription"),
                    cancel: t("cancel"),
                    ...formLabels(t),
                  }}
                />
              ) : null}
            </div>
            {list.items.length === 0 ? <p>{t("emptyItems")}</p> : null}
            {list.items.length > 0 ? (
              <Suspense
                fallback={
                  <ShoppingListRowsSkeleton
                    count={list.items.length}
                    quantity={list.purpose === "shopping"}
                  />
                }
              >
                <ShoppingListItems
                  locale={locale}
                  list={list}
                  fields={fields}
                />
              </Suspense>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("create")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ShoppingListForm
                action={saveShoppingList}
                fields={{ ...fields, _tag: "Create" }}
                label={t("create")}
                layout="inline"
                {...formLabels(t)}
              >
                <div className="grid min-w-0 grow gap-2">
                  <Label htmlFor="new-shopping-list-name">{t("name")}</Label>
                  <Input
                    id="new-shopping-list-name"
                    name="name"
                    maxLength={255}
                    required
                  />
                </div>
              </ShoppingListForm>
            </CardContent>
          </Card>
          {scope.businessUnitId.length > 0 ? (
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label={t("ownership")}
            >
              {(["mine", "others", "all"] as const).map((value) => (
                <Button
                  key={value}
                  variant={ownership === value ? "secondary" : "ghost"}
                  asChild
                >
                  <Link
                    href={shoppingListHref(
                      locale,
                      undefined,
                      new URLSearchParams({ ownership: value })
                    )}
                    aria-current={ownership === value ? "page" : undefined}
                  >
                    {t(value)}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null}
          {page?.items.length === 0 ? <p>{t("empty")}</p> : null}
          <ul className="grid gap-3">
            {page?.items.map((item) => (
              <li key={item.id} className="rounded-lg border p-4">
                <Link
                  href={shoppingListHref(locale, item.id)}
                  className="font-semibold underline underline-offset-4"
                >
                  {shoppingListName(item.name, locale)}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("items")}: {item.itemCount}
                </p>
              </li>
            ))}
          </ul>
          {page?.nextCursor ? (
            <Link
              href={shoppingListHref(
                locale,
                undefined,
                new URLSearchParams({ cursor: page.nextCursor, ownership })
              )}
            >
              {t("nextPage")}
            </Link>
          ) : null}
        </div>
      )}
    </CustomerAreaContent>
  );
}
