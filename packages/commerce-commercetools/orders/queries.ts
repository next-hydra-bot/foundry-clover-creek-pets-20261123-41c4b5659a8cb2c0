import type {
  Address,
  ByProjectKeyRequestBuilder,
  Order,
  LineItem,
  TaxRate,
} from "@commercetools/platform-sdk";
import {
  modelLabel,
  productModel,
} from "@repo/commerce-core/catalog/product-model";
import type { AuthenticatedCommercePrincipal } from "@repo/commerce-core/domain/commerce-request-context";
import {
  OrderDetail,
  OrderQueryFailure,
  OrderSummary,
} from "@repo/commerce-core/domain/order-history";
import type {
  FindOrderDetailInput,
  ListOrdersInput,
  OrderStoreSelection,
  OrderStatus,
  OrderPage,
} from "@repo/commerce-core/domain/order-history";
import { orderCursorCodec } from "@repo/commerce-core/lib/orders/cursor";
import {
  encodeOrderFilters,
  matchesOrderFilters,
} from "@repo/commerce-core/lib/orders/filters";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import type { OrderDetailPrincipal } from "@repo/commerce-core/services/order-queries";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import { CommercetoolsRestClient } from "../client/rest-client";
import { normalizeProductAttributeValue } from "../product-attributes/reader";
import { variantReference } from "../product/variant-reference";
import { orderAmounts, orderMoney, orderShipping } from "./amounts";

const failure = (
  operation: "list" | "findById",
  reason: OrderQueryFailure["reason"],
  cause?: unknown
) =>
  new OrderQueryFailure({
    cause,
    message: "Orders could not be read from commercetools.",
    operation,
    reason,
  });
const httpStatus = (cause: unknown) =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Struct({ statusCode: Schema.Finite }))(
      cause
    )
  )?.statusCode;
const owns = (order: Order, principal: OrderDetailPrincipal) => {
  if (principal._tag === "EmailOrderAccess") {
    return (
      order.id === principal.orderId &&
      order.businessUnit === undefined &&
      order.store?.key === principal.storeKey &&
      order.customerEmail === Redacted.value(principal.recipient)
    );
  }
  if (principal._tag === "B2CPurchasingPrincipal") {
    return (
      order.customerId === principal.customerId &&
      order.businessUnit === undefined
    );
  }
  return order.businessUnit?.key === principal.businessUnitKey;
};
const inStore = (order: Order, stores: OrderStoreSelection) =>
  stores._tag === "AllStores" || order.store?.key === stores.storeKey;
const text = (
  value: Readonly<Record<string, string>> | undefined,
  locale: string
) =>
  value?.[locale] ??
  value?.[locale.split("-")[0] ?? ""] ??
  Object.values(value ?? {})[0];

const address = (value: Address | undefined) =>
  value === undefined
    ? undefined
    : {
        addressLine1: value.streetName,
        addressLine2: value.additionalStreetInfo,
        city: value.city,
        company: value.company,
        country: value.country,
        postalCode: value.postalCode,
        recipient:
          [value.firstName, value.lastName].filter(Boolean).join(" ") ||
          undefined,
        region: value.region ?? value.state,
      };
const payment = new Map<string, OrderStatus["payment"]>([
  ["BalanceDue", "balanceDue"],
  ["CreditOwed", "creditOwed"],
  ["Failed", "failed"],
  ["Paid", "paid"],
  ["Pending", "pending"],
]);
const delivery = new Map<string, OrderStatus["delivery"]>([
  ["Pending", "pending"],
  ["Ready", "ready"],
  ["Delayed", "delayed"],
  ["Backorder", "backordered"],
  ["Delivered", "delivered"],
  ["Shipped", "inTransit"],
]);
const fulfillment = new Map<string, OrderStatus["fulfillment"]>([
  ["Pending", "unfulfilled"],
  ["Delivered", "fulfilled"],
  ["Shipped", "fulfilled"],
  ["Ready", "unfulfilled"],
]);
const taxTreatment = (rate: TaxRate | undefined) => {
  if (rate === undefined) {
    return "unknown";
  }
  return rate.includedInPrice ? "yes" : "no";
};
const summaryData = (
  order: Order,
  principal: OrderDetailPrincipal,
  locale: string
) => ({
  createdAt: order.createdAt,
  id: order.id,
  number: order.orderNumber,
  purchaseOrderNumber: order.purchaseOrderNumber,
  purchasingContext:
    principal._tag === "CustomerCommercePrincipal"
      ? { _tag: "B2BOrder", businessUnitId: principal.businessUnitId }
      : { _tag: "B2COrder" },
  status: {
    cancellation:
      order.orderState === "Cancelled" ? "cancelled" : "notCancelled",
    delivery: delivery.get(order.shipmentState ?? "") ?? "unknown",
    fulfillment: fulfillment.get(order.shipmentState ?? "") ?? "unknown",
    payment: payment.get(order.paymentState ?? "") ?? "unknown",
  },
  storeKey: order.store?.key,
  total: {
    money: orderMoney(order.taxedPrice?.totalGross ?? order.totalPrice),
    taxIncluded: order.taxedPrice === undefined ? "unknown" : "yes",
  },
  workflowState:
    order.state?.obj === undefined
      ? undefined
      : {
          key: order.state.obj.key,
          label: text(order.state.obj.name, locale) ?? order.state.obj.key,
        },
});
const EnumOption = Schema.Struct({ key: Schema.String, label: Schema.String });
const OptionValue = Schema.Union([Schema.String, Schema.Finite, EnumOption]);

/** Values belong to the Order snapshot; the Product Model only identifies selection dimensions. */
const recordedVariantOptions = (line: LineItem, locale: string) => {
  const definition = productModel.productTypes.find(
    ({ key }) => key === line.productType.obj?.key
  );
  return definition?.variantOptions.flatMap((key) => {
    const attribute = definition.attributes.find(
      (attribute) => attribute.key === key
    );
    const raw = Schema.decodeUnknownOption(Schema.Json)(
      line.variant.attributes?.find((attribute) => attribute.name === key)
        ?.value
    );
    if (attribute === undefined || Option.isNone(raw)) {
      return [];
    }
    const selected = Schema.decodeUnknownOption(OptionValue)(
      normalizeProductAttributeValue(raw.value, locale)
    );
    if (Option.isNone(selected)) {
      return [];
    }
    const value = Schema.is(EnumOption)(selected.value)
      ? selected.value.label
      : String(selected.value);
    return value
      ? [
          {
            name: modelLabel(
              attribute.labels,
              locale,
              productModel.defaultLocale
            ),
            value,
          },
        ]
      : [];
  });
};

const detailData = (
  order: Order,
  principal: OrderDetailPrincipal,
  locale: string
) => ({
  ...summaryData(order, principal, locale),
  amounts: orderAmounts(order),
  billingAddress: address(order.billingAddress),
  customerId: order.customerId,
  fulfillments: orderShipping(order)
    .flatMap((info) => info.deliveries ?? [])
    .map((nativeDelivery) => ({
      deliveryStatus: ["Shipped", "Delivered"].includes(
        order.shipmentState ?? ""
      )
        ? delivery.get(order.shipmentState ?? "")
        : "unknown",
      id: nativeDelivery.id,
      lineItems: nativeDelivery.items.map((item) => ({
        lineItemId: item.id,
        quantity: item.quantity,
      })),
      status: ["Shipped", "Delivered"].includes(order.shipmentState ?? "")
        ? "fulfilled"
        : "unknown",
      tracking: nativeDelivery.parcels
        .filter((parcel) => !parcel.trackingData?.isReturn)
        .flatMap((parcel) =>
          parcel.trackingData === undefined
            ? []
            : [
                {
                  carrier: parcel.trackingData.carrier,
                  number: parcel.trackingData.trackingId,
                },
              ]
        ),
    })),
  lineItems: [
    ...order.lineItems.map((line) => ({
      id: line.id,
      image:
        line.variant.images?.[0] === undefined
          ? undefined
          : {
              altText: line.variant.images[0].label,
              url: line.variant.images[0].url,
            },
      name: text(line.name, locale),
      orderedQuantity: line.quantity,
      productId: line.productId,
      sku: line.variant.sku,
      total: {
        money: orderMoney(line.taxedPrice?.totalNet ?? line.totalPrice),
        taxIncluded: line.taxedPrice ? "no" : taxTreatment(line.taxRate),
      },
      variantId: variantReference(line.productId, line.variant.id),
      variantOptions: recordedVariantOptions(line, locale),
    })),
    ...order.customLineItems.map((line) => ({
      id: line.id,
      name: text(line.name, locale),
      orderedQuantity: line.quantity,
      total: {
        money: orderMoney(line.taxedPrice?.totalNet ?? line.totalPrice),
        taxIncluded: line.taxedPrice ? "no" : taxTreatment(line.taxRate),
      },
    })),
  ],
  shippingAddress: address(order.shippingAddress),
  updatedAt: order.lastModifiedAt,
});
const Cursor = Schema.Struct({
  createdAt: Schema.String.check(
    Schema.makeFilter(
      (value) =>
        Option.isSome(
          Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(value)
        ),
      { expected: "a UTC date-time" }
    )
  ),
  id: Schema.NonEmptyString,
});

export const orderQueriesLayerFrom = (api: ByProjectKeyRequestBuilder) =>
  Layer.succeed(OrderQueries, {
    findById: Effect.fn("CommercetoolsOrderQueries.findById")(function* (
      principal: OrderDetailPrincipal,
      input: FindOrderDetailInput
    ) {
      const order = yield* Effect.tryPromise({
        catch: (cause) =>
          failure(
            "findById",
            httpStatus(cause) === 403 ? "configuration" : "unavailable",
            cause
          ),
        try: async () => {
          const response = await api
            .orders()
            .withId({ ID: input.id })
            .get({
              queryArgs: {
                expand: [
                  "state",
                  "lineItems[*].productType",
                  "paymentInfo.payments[*]",
                ],
              },
            })
            .execute();
          return response.body;
        },
      }).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          httpStatus(error.cause) === 404
            ? Effect.succeed(Option.none<Order>())
            : Effect.fail(error)
        )
      );
      if (
        Option.isNone(order) ||
        !owns(order.value, principal) ||
        !inStore(order.value, input.stores)
      ) {
        return Option.none<OrderDetail>();
      }
      return yield* Effect.try({
        catch: (cause) => failure("findById", "invalidData", cause),
        try: () => detailData(order.value, principal, input.locale),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(OrderDetail)),
        Effect.map(Option.some),
        Effect.mapError((cause) => failure("findById", "invalidData", cause))
      );
    }),
    list: Effect.fn("CommercetoolsOrderQueries.list")(function* (
      principal: AuthenticatedCommercePrincipal,
      input: ListOrdersInput
    ) {
      const cursor = orderCursorCodec(
        "commercetools-orders-v1",
        principal,
        input,
        Cursor
      );
      let after = yield* cursor.decode;
      const filters = encodeOrderFilters(input.filters);
      const constraints = [
        principal._tag === "B2CPurchasingPrincipal"
          ? `customerId=${JSON.stringify(principal.customerId)} and businessUnit is not defined`
          : `businessUnit(key=${JSON.stringify(principal.businessUnitKey)})`,
      ];
      if (input.stores._tag === "SingleStore") {
        constraints.push(`store(key=${JSON.stringify(input.stores.storeKey)})`);
      }
      if (filters.number) {
        constraints.push(`orderNumber=${JSON.stringify(filters.number)}`);
      }
      if (filters.createdFrom) {
        constraints.push(`createdAt>=${JSON.stringify(filters.createdFrom)}`);
      }
      if (filters.createdBefore) {
        constraints.push(`createdAt<${JSON.stringify(filters.createdBefore)}`);
      }
      if (filters.cancellation === "cancelled") {
        constraints.push('orderState="Cancelled"');
      }
      if (filters.cancellation === "notCancelled") {
        constraints.push('orderState!="Cancelled"');
      }
      for (const [field, mapping, selected] of [
        ["paymentState", payment, filters.payment],
        ["shipmentState", fulfillment, filters.fulfillment],
      ] as const) {
        const values = [...mapping]
          .filter(([, value]) => value === selected)
          .map(([key]) => JSON.stringify(key));
        if (selected && values.length) {
          constraints.push(`${field} in (${values.join(",")})`);
        }
      }
      const items: OrderSummary[] = [];
      const maxPages = 5;
      for (let page = 0; page < maxPages; page += 1) {
        const remaining = input.limit - items.length;
        const where = [...constraints];
        if (after) {
          where.push(
            `(createdAt<${JSON.stringify(after.createdAt)} or (createdAt=${JSON.stringify(after.createdAt)} and id<${JSON.stringify(after.id)}))`
          );
        }
        const response = yield* Effect.tryPromise({
          catch: (cause) =>
            failure(
              "list",
              httpStatus(cause) === 403 ? "configuration" : "unavailable",
              cause
            ),
          try: async () =>
            await api
              .orders()
              .get({
                queryArgs: {
                  expand: ["state"],
                  limit: remaining + 1,
                  sort: ["createdAt desc", "id desc"],
                  where,
                  withTotal: false,
                },
              })
              .execute(),
        });
        if (
          response.body.results.some(
            (order) => !owns(order, principal) || !inStore(order, input.stores)
          )
        ) {
          return yield* failure("list", "invalidData");
        }
        const records = response.body.results.slice(0, remaining);
        const summaries = yield* Effect.all(
          records.map((order) =>
            Effect.try({
              catch: (cause) => failure("list", "invalidData", cause),
              try: () => summaryData(order, principal, input.locale),
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(OrderSummary)),
              Effect.mapError((cause) => failure("list", "invalidData", cause))
            )
          )
        );
        items.push(
          ...summaries.filter((order) =>
            matchesOrderFilters(order, input.filters)
          )
        );
        const last = records.at(-1);
        if (response.body.results.length <= remaining || !last) {
          return { items } satisfies OrderPage;
        }
        if (after?.id === last.id && after.createdAt === last.createdAt) {
          return yield* failure("list", "invalidData");
        }
        after = { createdAt: last.createdAt, id: last.id };
        if (items.length === input.limit || page === maxPages - 1) {
          return {
            items,
            nextCursor: cursor.encode(after),
          } satisfies OrderPage;
        }
      }
      return { items } satisfies OrderPage;
    }),
  });
export const orderQueriesLayer = Layer.unwrap(
  CommercetoolsRestClient.pipe(
    Effect.map(({ apiRoot }) => orderQueriesLayerFrom(apiRoot))
  )
);
