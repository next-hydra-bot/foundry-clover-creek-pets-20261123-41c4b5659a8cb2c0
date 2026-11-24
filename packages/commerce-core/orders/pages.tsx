import { CustomerAreaContent } from "@repo/design-system/components/layout/customer-area";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/design-system/components/ui/collapsible";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import type { Locale } from "@repo/i18n/types";
import { DateTime, Option, Schema } from "effect";
import type { Route } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { FindOrderDetailInput } from "../domain/order-history";
import type {
  OrderDetail,
  OrderPage,
  ListOrdersInput,
} from "../domain/order-history";
import { CommerceLocale, storeConfiguration } from "../store";
import { OrderFilterSelect } from "./filter-select";
import {
  orderHistoryInput,
  orderHistorySearch,
  orderHistoryStatuses,
} from "./history-selection";
import type { OrderHistoryMode, OrderSearchParams } from "./history-selection";
import { OrderRowsSkeleton } from "./loading";
import {
  getOrderTranslations,
  OrderDetailContent,
  OrderReadError,
  OrderStatusBadges,
} from "./order-detail-view";
import type { OrderText } from "./order-detail-view";
import { formatOrderMoney } from "./presentation";
import type { OrderPageResult } from "./presentation";

export type { OrderSearchParams } from "./history-selection";
export { orderIdFromRoute } from "./history-selection";

const href = (
  locale: Locale,
  input?: Pick<ListOrdersInput, "stores" | "filters" | "after">
) => {
  const query = input ? orderHistorySearch(input) : new URLSearchParams();
  // SAFETY: This path is authored here; selected values are encoded as URL parameters.
  return `/${locale}/account/orders${query.size ? `?${query}` : ""}` as Route;
};
const detailHref = (
  locale: Locale,
  id: FindOrderDetailInput["id"],
  history: Pick<ListOrdersInput, "stores" | "filters" | "after">
) => {
  const query = orderHistorySearch(history);
  // SAFETY: Provider IDs are encoded into one segment; history selection is encoded separately.
  return `/${locale}/account/orders/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}` as Route;
};
function AccountOrderError({
  locale,
  reason,
  t,
  retryHref,
}: {
  readonly locale: Locale;
  readonly reason: string;
  readonly t: OrderText;
  readonly retryHref?: Route;
}) {
  const recoverSelection =
    reason === "invalidCursor" || reason === "invalidFilter";
  if (reason === "accessDenied") {
    return <OrderReadError reason={reason} t={t} />;
  }
  const action = recoverSelection ? (
    <Button asChild size="sm" variant="outline">
      <Link href={href(locale)}>
        {t(reason === "invalidCursor" ? "firstPage" : "clearFilters")}
      </Link>
    </Button>
  ) : (
    <Button asChild size="sm" variant="outline">
      <a href={retryHref ?? href(locale)}>{t("retry")}</a>
    </Button>
  );
  return <OrderReadError reason={reason} t={t} action={action} />;
}

function OrderListingFrame({
  t,
  children,
}: {
  readonly t: OrderText;
  readonly children: ReactNode;
}) {
  return (
    <CustomerAreaContent description={t("description")} title={t("title")}>
      {children}
    </CustomerAreaContent>
  );
}

function ReadFailure(props: Parameters<typeof AccountOrderError>[0]) {
  return (
    <OrderListingFrame t={props.t}>
      <AccountOrderError {...props} />
    </OrderListingFrame>
  );
}

function OrderHistoryFilters({
  locale,
  input,
  mode,
  t,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly t: OrderText;
}) {
  const form = orderHistorySearch(input);
  const stores = [...new Set(storeConfiguration.map((item) => item.storeKey))];
  const activeCount = ["purchaseOrderNumber", "from", "to"].filter((name) =>
    form.has(name)
  ).length;
  let storeSelection: ReactNode = null;
  if (mode === "company" && stores.length > 1) {
    storeSelection = (
      <div className="grid w-full gap-2 sm:w-40">
        <Label htmlFor="order-store">{t("store")}</Label>
        <OrderFilterSelect
          id="order-store"
          name="store"
          defaultValue={form.get("store") ?? ""}
          allLabel={t("allStores")}
          options={stores.map((key) => ({ label: key, value: key }))}
        />
      </div>
    );
  } else if (mode === "company" && input.stores._tag === "SingleStore") {
    storeSelection = (
      <input type="hidden" name="store" value={input.stores.storeKey} />
    );
  }
  return (
    <Form action={href(locale)} className="mb-5" key={form.toString()}>
      <Collapsible defaultOpen={activeCount > 0}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-48 flex-1 gap-2">
            <Label htmlFor="order-number">{t("orderNumberFilter")}</Label>
            <Input
              defaultValue={form.get("number") ?? ""}
              id="order-number"
              name="number"
              type="search"
              placeholder={t("searchPlaceholder")}
            />
          </div>
          <div className="grid w-full gap-2 sm:w-44">
            <Label htmlFor="order-status">{t("statusLabel")}</Label>
            <OrderFilterSelect
              id="order-status"
              name="status"
              defaultValue={form.get("status") ?? ""}
              allLabel={t("anyStatus")}
              options={orderHistoryStatuses.map((value) => ({
                label: t(`status.${value}`),
                value,
              }))}
            />
          </div>
          {storeSelection}
          <Button type="submit" variant="secondary">
            {t("search")}
          </Button>
          {mode === "company" ? (
            <CollapsibleTrigger asChild>
              <Button className="group" type="button" variant="outline">
                {t("filters")}
                {activeCount ? (
                  <Badge variant="secondary">{activeCount}</Badge>
                ) : null}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="size-4 transition-transform group-data-[state=open]:rotate-180"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </Button>
            </CollapsibleTrigger>
          ) : null}
          {mode === "personal" && (form.has("number") || form.has("status")) ? (
            <Button asChild variant="ghost">
              <Link href={href(locale)}>{t("clearFilters")}</Link>
            </Button>
          ) : null}
        </div>
        {mode === "company" ? (
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="order-purchaseOrderNumber">
                    {t("purchaseOrderFilter")}
                  </Label>
                  <Input
                    defaultValue={form.get("purchaseOrderNumber") ?? ""}
                    id="order-purchaseOrderNumber"
                    name="purchaseOrderNumber"
                  />
                </div>
                {(["from", "to"] as const).map((name) => (
                  <div className="grid gap-2" key={name}>
                    <Label htmlFor={`order-${name}`}>
                      {t(name === "from" ? "dateFrom" : "dateTo")}
                    </Label>
                    <Input
                      defaultValue={form.get(name) ?? ""}
                      id={`order-${name}`}
                      name={name}
                      type="date"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t pt-4">
                <Button asChild variant="ghost">
                  <Link href={href(locale)}>{t("clearFilters")}</Link>
                </Button>
                <Button type="submit">{t("apply")}</Button>
              </div>
            </div>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </Form>
  );
}

function OrderHistoryResults({
  locale,
  input,
  mode,
  result,
  t,
  emptyAction,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly result: OrderPageResult<OrderPage>;
  readonly t: OrderText;
  readonly emptyAction?: ReactNode;
}) {
  if (result.error !== undefined) {
    return (
      <AccountOrderError
        locale={locale}
        reason={result.error}
        t={t}
        retryHref={href(locale, input)}
      />
    );
  }
  const filtered =
    input.stores._tag === "SingleStore" ||
    Object.values(input.filters ?? {}).some((value) => value !== undefined);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  let emptyTitle = t("empty");
  let emptyDescription = t("emptyDescription");
  if (result.value.historyLimitDays !== undefined) {
    emptyTitle = t("emptyRecent");
    emptyDescription = t("emptyRecentDescription");
  }
  if (filtered) {
    emptyTitle = t("noMatches");
    emptyDescription = t("noMatchesDescription");
  }
  if (result.value.nextCursor) {
    emptyTitle = t("noMatches");
    emptyDescription = t("emptyPage");
  }
  return (
    <>
      <OrderHistoryFilters locale={locale} input={input} mode={mode} t={t} />
      {result.value.historyLimitDays === undefined ? null : (
        <p className="mb-4 text-muted-foreground text-sm">
          {t("historyLimit", { days: result.value.historyLimitDays })}
        </p>
      )}
      {result.value.items.length === 0 ? (
        <div
          className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center"
          role="status"
        >
          <h3 className="font-semibold text-lg">{emptyTitle}</h3>
          <p className="mt-2 max-w-sm text-muted-foreground text-sm">
            {emptyDescription}
          </p>
          {result.value.nextCursor ? null : (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link href={filtered ? href(locale) : `/${locale}/products`}>
                  {t(filtered ? "clearFilters" : "continueShopping")}
                </Link>
              </Button>
              {emptyAction}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="px-4">{t("order")}</TableHead>
                <TableHead className="hidden px-4 md:table-cell">
                  {t("date")}
                </TableHead>
                <TableHead className="px-4">{t("statusLabel")}</TableHead>
                <TableHead className="px-4 text-right">{t("total")}</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">{t("viewOrder")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.value.items.map((order) => {
                const destination = detailHref(locale, order.id, input);
                const placed = date.format(DateTime.toDateUtc(order.createdAt));
                return (
                  <TableRow key={order.id}>
                    <TableCell className="px-4 py-5">
                      <Link
                        className="font-semibold underline-offset-4 hover:underline"
                        href={destination}
                      >
                        {order.number ?? t("viewOrder")}
                      </Link>
                      {order.purchaseOrderNumber ? (
                        <p className="mt-1 text-muted-foreground text-xs">
                          {t("purchaseOrder")}: {order.purchaseOrderNumber}
                        </p>
                      ) : null}
                      <time
                        className="mt-1 block text-muted-foreground text-xs md:hidden"
                        dateTime={DateTime.formatIso(order.createdAt)}
                      >
                        {placed}
                      </time>
                      {order.storeKey ? (
                        <p className="mt-1 text-muted-foreground text-xs md:hidden">
                          {order.storeKey}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden px-4 py-5 md:table-cell">
                      <time dateTime={DateTime.formatIso(order.createdAt)}>
                        {placed}
                      </time>
                      {order.storeKey ? (
                        <p className="mt-1 text-muted-foreground text-xs">
                          {order.storeKey}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-52 whitespace-normal px-4 py-5">
                      <OrderStatusBadges status={order.status} t={t} />
                    </TableCell>
                    <TableCell className="px-4 py-5 text-right font-medium tabular-nums">
                      {formatOrderMoney(order.total.money, locale)}
                    </TableCell>
                    <TableCell className="pr-3">
                      <Button asChild size="icon" variant="ghost">
                        <Link
                          href={destination}
                          aria-label={`${t("viewOrder")} ${order.number ?? ""}`}
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="size-4"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {input.after || result.value.nextCursor ? (
        <nav
          aria-label={t("pagination")}
          className="mt-5 flex items-center justify-between gap-3"
        >
          {input.after ? (
            <Button asChild variant="ghost">
              <Link href={href(locale, { ...input, after: undefined })}>
                {t("firstPage")}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {result.value.nextCursor ? (
            <Button asChild variant="outline">
              <Link
                href={href(locale, {
                  ...input,
                  after: result.value.nextCursor,
                })}
              >
                {t(result.value.items.length ? "nextPage" : "continueSearch")}
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

/** Presentation receives an explicit read result and has no request or provider dependencies. */
export function OrderListingView({
  locale,
  input,
  mode,
  result,
  t,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly result: OrderPageResult<OrderPage>;
  readonly t: OrderText;
}) {
  return (
    <OrderListingFrame t={t}>
      <OrderHistoryResults
        locale={locale}
        input={input}
        mode={mode}
        result={result}
        t={t}
      />
    </OrderListingFrame>
  );
}
export function OrderDetailView({
  locale,
  input,
  result,
  t,
  history,
}: {
  readonly locale: Locale;
  readonly input: FindOrderDetailInput;
  readonly history?: ListOrdersInput;
  readonly result: OrderPageResult<Option.Option<OrderDetail>>;
  readonly t: OrderText;
}) {
  const back = history ?? { ...input, limit: 20 };
  return (
    <OrderDetailContent
      locale={locale}
      result={result}
      t={t}
      renderFailure={(reason) => (
        <ReadFailure
          locale={locale}
          reason={reason}
          t={t}
          retryHref={detailHref(locale, input.id, back)}
        />
      )}
      backLink={
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 mb-4 text-muted-foreground"
        >
          <Link href={href(locale, back)}>
            <span aria-hidden="true">←</span>
            {t("back")}
          </Link>
        </Button>
      }
    />
  );
}

interface OrderListingPageProps {
  readonly locale: Locale;
  readonly mode: OrderHistoryMode;
  readonly searchParams: OrderSearchParams;
  readonly emptyAction?: ReactNode;
  readonly load: (
    input: ListOrdersInput
  ) => Promise<OrderPageResult<OrderPage>>;
}
async function LoadedOrderHistory({
  locale,
  input,
  mode,
  load,
  t,
  emptyAction,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly load: OrderListingPageProps["load"];
  readonly t: OrderText;
  readonly emptyAction?: ReactNode;
}) {
  const result = await load(input);
  return (
    <OrderHistoryResults
      emptyAction={emptyAction}
      locale={locale}
      input={input}
      mode={mode}
      result={result}
      t={t}
    />
  );
}
export const OrderListingPage = async ({
  locale,
  mode,
  searchParams,
  load,
  emptyAction,
}: OrderListingPageProps) => {
  await connection();
  const parsed = orderHistoryInput(
    CommerceLocale.make(locale),
    searchParams,
    mode
  );
  const t = await getOrderTranslations(locale);
  if (Option.isNone(parsed)) {
    return <ReadFailure locale={locale} reason="invalidFilter" t={t} />;
  }
  const input = parsed.value;
  return (
    <OrderListingFrame t={t}>
      <Suspense
        key={orderHistorySearch(input).toString()}
        fallback={<OrderRowsSkeleton />}
      >
        <LoadedOrderHistory
          emptyAction={emptyAction}
          locale={locale}
          input={input}
          mode={mode}
          load={load}
          t={t}
        />
      </Suspense>
    </OrderListingFrame>
  );
};

export const OrderDetailPage = async ({
  locale,
  mode,
  orderId,
  searchParams,
  load,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly mode: OrderHistoryMode;
  readonly searchParams: OrderSearchParams;
  readonly load: (
    input: FindOrderDetailInput
  ) => Promise<OrderPageResult<Option.Option<OrderDetail>>>;
}) => {
  await connection();
  const history = orderHistoryInput(
    CommerceLocale.make(locale),
    searchParams,
    mode
  );
  if (Option.isNone(history)) {
    notFound();
  }
  const input = Schema.decodeUnknownSync(FindOrderDetailInput)({
    id: orderId,
    locale,
    stores: history.value.stores,
  });
  const [result, t] = await Promise.all([
    load(input),
    getOrderTranslations(locale),
  ]);
  return (
    <OrderDetailView
      locale={locale}
      input={input}
      result={result}
      t={t}
      history={history.value}
    />
  );
};
