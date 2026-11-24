import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/design-system/components/ui/alert";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@repo/design-system/components/ui/card";
import { Separator } from "@repo/design-system/components/ui/separator";
import { cn } from "@repo/design-system/lib/utils";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { DateTime, Option } from "effect";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { ReactElement, ReactNode } from "react";

import type {
  OrderAddress,
  OrderDetail,
  OrderMoney,
  OrderStatus,
} from "../domain/order-history";
import { formatOrderMoney } from "./presentation";
import type { OrderPageResult } from "./presentation";

export const getOrderTranslations = async (locale: Locale) =>
  await getTranslations({ locale, namespace: "web.orderHistory" });

export type OrderText = (
  key: Parameters<Awaited<ReturnType<typeof getOrderTranslations>>>[0],
  values?: Readonly<Record<string, string | number>>
) => string;

export const OrderReadError = ({
  reason,
  t,
  action,
}: {
  readonly reason: string;
  readonly t: OrderText;
  readonly action?: ReactNode;
}) => {
  let message = t("unavailable");
  switch (reason) {
    case "accessDenied": {
      message = t("accessDenied");
      break;
    }
    case "configuration": {
      message = t("configuration");
      break;
    }
    case "invalidCursor": {
      message = t("invalidCursor");
      break;
    }
    case "invalidFilter": {
      message = t("invalidFilter");
      break;
    }
    default: {
      break;
    }
  }
  return (
    <Alert className="py-5">
      <AlertTitle>{t("errorTitle")}</AlertTitle>
      <AlertDescription className="gap-4">
        <p>{message}</p>
        {action}
      </AlertDescription>
    </Alert>
  );
};
export function OrderStatusBadges({
  status,
  t,
}: {
  readonly status: OrderStatus;
  readonly t: OrderText;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {status.cancellation === "cancelled" ? (
        <Badge variant="outline">{t("status.cancelled")}</Badge>
      ) : null}
      {status.payment === "unknown" ? null : (
        <Badge
          variant={status.payment === "paid" ? "secondary" : "outline"}
          className={
            status.payment === "paid"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : undefined
          }
        >
          {t(`status.${status.payment}`)}
        </Badge>
      )}
      {status.fulfillment !== "unknown" &&
      status.fulfillment !== "notRequired" ? (
        <Badge
          variant={status.fulfillment === "fulfilled" ? "secondary" : "outline"}
        >
          {t(`status.${status.fulfillment}`)}
        </Badge>
      ) : null}
      {status.payment === "unknown" &&
      (status.fulfillment === "unknown" ||
        status.fulfillment === "notRequired") &&
      status.cancellation !== "cancelled" ? (
        <span className="text-muted-foreground text-sm">
          {t("statusUnavailable")}
        </span>
      ) : null}
    </div>
  );
}

const Address = ({ value }: { readonly value: OrderAddress }) => (
  <address className="text-sm leading-6 not-italic">
    {value.recipient ? <p className="font-medium">{value.recipient}</p> : null}
    {value.company ? <p>{value.company}</p> : null}
    {value.addressLine1 ? <p>{value.addressLine1}</p> : null}
    {value.addressLine2 ? <p>{value.addressLine2}</p> : null}
    {[value.city, value.region, value.postalCode].some(Boolean) ? (
      <p>
        {[value.city, value.region, value.postalCode].filter(Boolean).join(" ")}
      </p>
    ) : null}
    {value.country ? <p>{value.country}</p> : null}
  </address>
);
const isZeroMoney = (money: OrderMoney) => /^-?0(?:\.0+)?$/u.test(money.amount);
export function OrderDetailContent({
  locale,
  result,
  t,
  emailAccess = false,
  backLink,
  renderFailure,
}: {
  readonly locale: Locale;
  readonly result: OrderPageResult<Option.Option<OrderDetail>>;
  readonly t: OrderText;
  readonly emailAccess?: boolean;
  readonly backLink?: ReactNode;
  readonly renderFailure?: (reason: string) => ReactElement;
}) {
  if (result.error !== undefined) {
    return renderFailure ? (
      renderFailure(result.error)
    ) : (
      <section className="mx-auto min-h-96 max-w-4xl space-y-4 px-4 py-8">
        <h1 className="font-semibold text-2xl">{t("title")}</h1>
        <OrderReadError reason={result.error} t={t} />
      </section>
    );
  }
  if (Option.isNone(result.value)) {
    notFound();
  }
  const order = result.value.value;
  const title = `${t("order")} ${order.number ?? order.id}`;
  const Heading = emailAccess ? "h1" : "h2";
  const adjustments = (
    ["discounts", "refunded", "outstanding"] as const
  ).flatMap((key) => {
    const money = order.amounts[key];
    return money && !isZeroMoney(money) ? [{ key, money }] : [];
  });
  return (
    <section
      aria-label={title}
      className={
        emailAccess ? "mx-auto min-h-96 max-w-4xl px-4 py-8" : "min-w-0"
      }
    >
      {backLink}
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <CardHeader className="gap-5 px-5 py-6 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="grid gap-3">
              <OrderStatusBadges status={order.status} t={t} />
              <div className="grid gap-1.5">
                <Heading className="font-semibold text-2xl tracking-tight">
                  {title}
                </Heading>
                <time
                  className="text-muted-foreground text-sm"
                  dateTime={DateTime.formatIso(order.createdAt)}
                >
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "long",
                    timeZone: "UTC",
                  }).format(DateTime.toDateUtc(order.createdAt))}
                </time>
              </div>
            </div>
            {order.storeKey || order.purchaseOrderNumber ? (
              <dl className="grid gap-2 text-sm">
                {order.purchaseOrderNumber ? (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                    <dt className="text-muted-foreground">
                      {t("purchaseOrder")}
                    </dt>
                    <dd className="break-words text-right font-medium">
                      {order.purchaseOrderNumber}
                    </dd>
                  </div>
                ) : null}
                {order.storeKey ? (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                    <dt className="text-muted-foreground">{t("store")}</dt>
                    <dd className="break-words text-right">{order.storeKey}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
          {order.status.delivery !== "unknown" &&
          order.status.delivery !== "notRequired" ? (
            <p className="text-muted-foreground text-sm">
              {t("delivery")}: {t(`status.${order.status.delivery}`)}
            </p>
          ) : null}
        </CardHeader>
        <Separator />
        <CardContent className="px-5 sm:px-6">
          <h3 className="pt-5 font-medium text-sm">{t("items")}</h3>
          <ul className="divide-y">
            {order.lineItems.map((line) => (
              <li
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 py-5 sm:grid-cols-[4rem_minmax(0,1fr)_auto]"
                key={line.id}
              >
                <div className="relative row-span-2 aspect-square self-start overflow-hidden rounded-lg border bg-muted/40 sm:row-span-1">
                  {line.image ? (
                    <Image
                      src={line.image.url}
                      alt={line.image.altText ?? line.name}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid size-full place-items-center font-medium text-muted-foreground/50 text-xl"
                    >
                      {line.name.charAt(0)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 self-center">
                  <p className="break-words font-medium text-sm">{line.name}</p>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground text-sm">
                    {(line.variantOptions?.length ?? 0) > 0 ? (
                      <dl className="flex flex-wrap gap-x-3 gap-y-1">
                        {line.variantOptions?.map((option) => (
                          <div className="flex gap-1" key={option.name}>
                            <dt className="capitalize">{option.name}:</dt>
                            <dd>{option.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {(line.variantOptions?.length ?? 0) === 0 &&
                    line.variantLabel ? (
                      <span>{line.variantLabel}</span>
                    ) : null}
                    {(line.variantOptions?.length ?? 0) > 0 ||
                    line.variantLabel ? (
                      <span aria-hidden="true">·</span>
                    ) : null}
                    <span
                      aria-label={`${t("quantity")}: ${line.orderedQuantity}`}
                    >
                      {t("quantityShort")} {line.orderedQuantity}
                    </span>
                    {line.currentQuantity !== undefined &&
                    line.currentQuantity !== line.orderedQuantity ? (
                      <span>
                        {t("currentQuantity")}: {line.currentQuantity}
                      </span>
                    ) : null}
                  </div>
                  {line.sku ? (
                    <p className="mt-1 break-all text-muted-foreground text-xs">
                      {t("sku")}: {line.sku}
                    </p>
                  ) : null}
                </div>
                <div className="col-start-2 self-center text-sm tabular-nums sm:col-start-3 sm:text-right">
                  {line.total ? (
                    <p className="font-medium">
                      {formatOrderMoney(line.total.money, locale)}
                    </p>
                  ) : null}
                  {!line.total && line.unitPrice ? (
                    <p>
                      {formatOrderMoney(line.unitPrice, locale)} {t("each")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
        <Separator />
        <CardContent className="px-5 py-5 sm:px-6">
          <dl className="ml-auto grid w-full gap-3 text-sm sm:max-w-xs">
            {(["subtotal", "shipping", "tax"] as const).map((key) => {
              const amount = order.amounts[key];
              if (!amount) {
                return null;
              }
              const money = "money" in amount ? amount.money : amount;
              return (
                <div
                  className="flex items-baseline justify-between gap-6"
                  key={key}
                >
                  <dt className="text-muted-foreground">
                    {t(
                      key === "tax" &&
                        order.amounts.subtotal?.taxIncluded === "yes"
                        ? "taxIncluded"
                        : key
                    )}
                  </dt>
                  <dd className="shrink-0 tabular-nums">
                    {formatOrderMoney(money, locale)}
                  </dd>
                </div>
              );
            })}
            <div className="mt-1 flex items-baseline justify-between gap-6 border-t pt-4 font-semibold text-base">
              <dt>{t("total")}</dt>
              <dd className="shrink-0 tabular-nums">
                {formatOrderMoney(order.total.money, locale)}
              </dd>
            </div>
          </dl>
          {adjustments.length > 0 ? (
            <section
              className="mt-5 ml-auto w-full border-t pt-4 sm:max-w-xs"
              aria-label={t("adjustments")}
            >
              <h3 className="mb-3 font-medium text-sm">{t("adjustments")}</h3>
              <dl className="grid gap-3 text-sm">
                {adjustments.map(({ key, money }) => (
                  <div
                    className="flex items-baseline justify-between gap-6"
                    key={key}
                  >
                    <dt className="text-muted-foreground">
                      {t(key === "discounts" ? "discountsApplied" : key)}
                    </dt>
                    <dd className="shrink-0 tabular-nums">
                      {formatOrderMoney(money, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </CardContent>
        {order.shippingAddress ||
        order.billingAddress ||
        order.fulfillments.length > 0 ? (
          <>
            <Separator />
            <CardContent
              className={cn(
                "grid gap-6 bg-muted/20 px-5 py-5 sm:grid-cols-2 sm:px-6",
                order.fulfillments.length > 0 && "lg:grid-cols-3"
              )}
            >
              {order.shippingAddress ? (
                <section className="min-w-0">
                  <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {t("shippingAddress")}
                  </h3>
                  <Address value={order.shippingAddress} />
                </section>
              ) : null}
              {order.billingAddress ? (
                <section className="min-w-0">
                  <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {t("billingAddress")}
                  </h3>
                  <Address value={order.billingAddress} />
                </section>
              ) : null}
              {order.fulfillments.length > 0 ? (
                <section className="min-w-0 sm:col-span-2 lg:col-span-1">
                  <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {t("tracking")}
                  </h3>
                  <ul className="grid gap-4 text-sm">
                    {order.fulfillments.map((shipment) => (
                      <li className="grid gap-2" key={shipment.id}>
                        {shipment.tracking.length > 0 ? (
                          <ul className="grid gap-2">
                            {shipment.tracking.map((tracking) => (
                              <li
                                className="grid gap-0.5"
                                key={`${tracking.carrier}:${tracking.number}:${tracking.url}`}
                              >
                                {tracking.carrier ? (
                                  <p className="font-medium">
                                    {tracking.carrier}
                                  </p>
                                ) : null}
                                {tracking.url ? (
                                  <a
                                    className="w-fit max-w-full break-all text-muted-foreground underline underline-offset-4 hover:text-foreground"
                                    href={tracking.url}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                  >
                                    {tracking.number ?? t("track")}{" "}
                                    <span aria-hidden="true">↗</span>
                                  </a>
                                ) : (
                                  <p className="break-all text-muted-foreground">
                                    {tracking.number}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="flex flex-wrap gap-x-2 text-muted-foreground text-xs">
                          {shipment.status === "unknown" ? null : (
                            <span>{t(`status.${shipment.status}`)}</span>
                          )}
                          {shipment.deliveryStatus !== "unknown" &&
                          shipment.deliveryStatus !== "notRequired" ? (
                            <span>
                              {t(`status.${shipment.deliveryStatus}`)}
                            </span>
                          ) : null}
                        </div>
                        {shipment.lineItems.length > 0 ? (
                          <ul className="grid gap-1 text-muted-foreground text-xs">
                            {shipment.lineItems.map((item) => (
                              <li key={item.lineItemId}>
                                {order.lineItems.find(
                                  (line) => line.id === item.lineItemId
                                )?.name ?? t("items")}{" "}
                                × {item.quantity}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </CardContent>
          </>
        ) : null}
      </Card>
    </section>
  );
}
