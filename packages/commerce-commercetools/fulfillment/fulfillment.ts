import type {
  Address,
  BaseAddress,
  ByProjectKeyRequestBuilder,
  Delivery,
  Order,
  OrderUpdateAction,
  ShippingInfo,
} from "@commercetools/platform-sdk";
import type { OrderId } from "@repo/commerce-core/domain/order-identity";
import {
  FulfillmentFailure,
  FulfillmentListInput,
  FulfillmentOrder,
  FulfillmentPage,
  PackDeliveryInput,
  ShipParcelInput,
} from "@repo/commerce-core/fulfillment/model";
import { OrderFulfillment } from "@repo/commerce-core/fulfillment/service";
import {
  validatePack,
  validateShip,
} from "@repo/commerce-core/fulfillment/validation";
import { Effect, Layer, Schema } from "effect";

import { CommercetoolsRestClient } from "../client/rest-client";
import {
  isCommercetoolsAccessDenied,
  isConcurrentModification,
  hasCommercetoolsErrorCode,
} from "../client/versioned-write";

const failure = (
  reason: FulfillmentFailure["reason"],
  message: string,
  cause?: unknown
) => new FulfillmentFailure({ cause, message, reason });
const readFailure = (cause: unknown) => {
  let reason: FulfillmentFailure["reason"] = "unavailable";
  if (hasCommercetoolsErrorCode(cause, "ResourceNotFound")) {
    reason = "notFound";
  } else if (isCommercetoolsAccessDenied(cause)) {
    reason = "configuration";
  }
  return failure(reason, "Order fulfillment could not be read.", cause);
};
const writeFailure = (cause: unknown) => {
  let reason: FulfillmentFailure["reason"] = "outcomeUnknown";
  if (hasCommercetoolsErrorCode(cause, "ResourceNotFound")) {
    reason = "notFound";
  } else if (isConcurrentModification(cause)) {
    reason = "conflict";
  } else if (isCommercetoolsAccessDenied(cause)) {
    reason = "configuration";
  } else if (
    hasCommercetoolsErrorCode(cause, "InvalidInput", "InvalidOperation")
  ) {
    reason = "invalidInput";
  }
  return failure(
    reason,
    "The fulfillment write could not be confirmed. Refresh the Order before trying again.",
    cause
  );
};
const address = (value: Address | undefined) =>
  value
    ? {
        addressLine1: [value.streetNumber, value.streetName]
          .filter(Boolean)
          .join(" "),
        addressLine2: value.additionalStreetInfo,
        city: value.city,
        company: value.company,
        country: value.country,
        postalCode: value.postalCode,
        recipient: [value.firstName, value.lastName].filter(Boolean).join(" "),
        region: value.region,
      }
    : undefined;
const deliveryAddress = (value: Address): BaseAddress => {
  const { streetNumber, ...fields } = value;
  return {
    ...fields,
    streetName: [streetNumber, value.streetName].filter(Boolean).join(" "),
  };
};
const aggregate = (
  items: readonly { readonly id: string; readonly quantity: number }[]
) => {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.id, (totals.get(item.id) ?? 0) + item.quantity);
  }
  return [...totals].map(([lineItemId, quantity]) => ({
    lineItemId,
    quantity,
  }));
};
const delivery = (value: Delivery) => {
  const parcels = value.parcels
    .filter((parcel) => !parcel.trackingData?.isReturn)
    .map((parcel) => {
      if (!parcel.items) {
        throw failure(
          "invalidData",
          "A native Parcel has no item quantities. Add its quantities before using fulfillment."
        );
      }
      return {
        id: parcel.id,
        items: aggregate(parcel.items),
        tracking: parcel.trackingData
          ? {
              carrier: parcel.trackingData.carrier,
              number: parcel.trackingData.trackingId,
            }
          : undefined,
      };
    });
  const items = value.items.length
    ? aggregate(value.items)
    : aggregate(
        parcels.flatMap((parcel) =>
          parcel.items.map((item) => ({
            id: item.lineItemId,
            quantity: item.quantity,
          }))
        )
      );
  for (const parcel of parcels) {
    for (const item of parcel.items) {
      if (
        !items.some((allocation) => allocation.lineItemId === item.lineItemId)
      ) {
        throw failure(
          "invalidData",
          "Native Parcel items do not belong to their Delivery."
        );
      }
    }
  }
  for (const item of items) {
    const shipped = parcels
      .flatMap((parcel) => parcel.items)
      .filter((line) => line.lineItemId === item.lineItemId)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (shipped > item.quantity) {
      throw failure(
        "invalidData",
        "Native Parcels exceed their Delivery allocation."
      );
    }
  }
  return { address: address(value.address), id: value.id, items, parcels };
};
/** Single-address and native multiple-shipping Orders use the same opaque group interface. */
export const fulfillmentOrder = (order: Order, locale: string) => {
  const nativeLines = [...order.lineItems, ...order.customLineItems];
  const groups: {
    address: Address | undefined;
    id: string;
    info: ShippingInfo;
  }[] = [];
  if (order.shippingMode === "Multiple") {
    groups.push(
      ...(order.shipping ?? []).map((shipping) => ({
        address: shipping.shippingAddress,
        id: shipping.shippingKey,
        info: shipping.shippingInfo,
      }))
    );
  } else if (order.shippingInfo) {
    groups.push({
      address: order.shippingAddress,
      id: "default",
      info: order.shippingInfo,
    });
  }
  if (
    order.shippingMode !== "Multiple" &&
    nativeLines.some((line) =>
      line.shippingDetails?.targets.some(
        (target) => target.addressKey !== order.shippingAddress?.key
      )
    )
  ) {
    throw failure(
      "configuration",
      "This Order uses multiple item addresses with a single shipping method. Use native multiple shipping groups for this fulfillment screen."
    );
  }
  const detail = Schema.decodeUnknownSync(FulfillmentOrder)({
    cancelled: order.orderState === "Cancelled",
    groups: groups.map((group) => {
      const deliveries = (group.info.deliveries ?? []).map(delivery);
      const lines = nativeLines
        .map((line) => {
          const ordered =
            order.shippingMode === "Multiple"
              ? (line.shippingDetails?.targets ?? [])
                  .filter((target) => target.shippingMethodKey === group.id)
                  .reduce((sum, target) => sum + target.quantity, 0)
              : line.quantity;
          return {
            id: line.id,
            name:
              line.name[locale] ??
              line.name["en-US"] ??
              Object.values(line.name)[0] ??
              "",
            ordered,
            packed: deliveries
              .flatMap((item) => item.items)
              .filter((item) => item.lineItemId === line.id)
              .reduce((sum, item) => sum + item.quantity, 0),
            shipped: deliveries
              .flatMap((item) => item.parcels)
              .flatMap((parcel) => parcel.items)
              .filter((item) => item.lineItemId === line.id)
              .reduce((sum, item) => sum + item.quantity, 0),
            sku: "variant" in line ? line.variant.sku : undefined,
          };
        })
        .filter((line) => line.ordered > 0);
      if (
        deliveries
          .flatMap((item) => item.items)
          .some((item) => !lines.some((line) => line.id === item.lineItemId))
      ) {
        throw failure(
          "invalidData",
          "Native Delivery items do not belong to their shipping group."
        );
      }
      return {
        address: address(group.address),
        deliveries,
        id: group.id,
        lines,
        name: group.info.shippingMethodName,
      };
    }),
    id: order.id,
    number: order.orderNumber,
    revision: String(order.version),
    writable:
      !["Cancelled", "Complete"].includes(order.orderState) &&
      !["Shipped", "Delivered"].includes(order.shipmentState ?? ""),
  });
  for (const line of nativeLines) {
    const allocated = detail.groups
      .flatMap((group) => group.lines)
      .filter((item) => item.id === line.id)
      .reduce((sum, item) => sum + item.ordered, 0);
    if (allocated !== line.quantity) {
      throw failure(
        "configuration",
        "Order lines are not fully allocated to native shipping groups."
      );
    }
  }
  return detail;
};
export const orderFulfillmentLayerFrom = (api: ByProjectKeyRequestBuilder) => {
  const read = (id: OrderId) =>
    Effect.tryPromise({
      catch: readFailure,
      try: async () => {
        const response = await api.orders().withId({ ID: id }).get().execute();
        return response.body;
      },
    });
  const project = (order: Order, locale: string) =>
    Effect.try({
      catch: (cause) =>
        Schema.is(FulfillmentFailure)(cause)
          ? cause
          : failure(
              "invalidData",
              "Native fulfillment quantities are inconsistent.",
              cause
            ),
      try: () => fulfillmentOrder(order, locale),
    });
  const write = (order: Order, actions: OrderUpdateAction[], locale: string) =>
    Effect.tryPromise({
      catch: writeFailure,
      try: async () => {
        const response = await api
          .orders()
          .withId({ ID: order.id })
          .post({ body: { actions, version: order.version } })
          .execute();
        return response.body;
      },
    }).pipe(Effect.flatMap((updated) => project(updated, locale)));
  return Layer.succeed(OrderFulfillment, {
    get: (id, locale) =>
      read(id).pipe(Effect.flatMap((order) => project(order, locale))),
    list: (input) =>
      Effect.gen(function* () {
        const query = yield* Schema.decodeEffect(FulfillmentListInput)(
          input
        ).pipe(
          Effect.mapError((cause) =>
            failure("invalidInput", "Invalid fulfillment query.", cause)
          )
        );
        const where = [
          'orderState not in ("Cancelled","Complete")',
          '(shipmentState is not defined or shipmentState not in ("Shipped","Delivered"))',
        ];
        if (query.after) {
          where.push(`id>${JSON.stringify(query.after)}`);
        }
        if (query.orderNumber) {
          where.push(`orderNumber=${JSON.stringify(query.orderNumber)}`);
        }
        const response = yield* Effect.tryPromise({
          catch: readFailure,
          try: async () =>
            await api
              .orders()
              .get({
                queryArgs: {
                  limit: query.limit + 1,
                  sort: ["id asc"],
                  where,
                  withTotal: false,
                },
              })
              .execute(),
        });
        const records = response.body.results.slice(0, query.limit);
        return yield* Schema.decodeEffect(FulfillmentPage)({
          items: records.map((order) => ({
            createdAt: order.createdAt,
            id: order.id,
            number: order.orderNumber,
            storeKey: order.store?.key,
          })),
          nextCursor:
            response.body.results.length > query.limit
              ? records.at(-1)?.id
              : undefined,
        }).pipe(
          Effect.mapError((cause) =>
            failure("invalidData", "Native Order listing is invalid.", cause)
          )
        );
      }),
    pack: (id, input, locale) =>
      Effect.gen(function* () {
        const command = yield* Schema.decodeEffect(PackDeliveryInput)(
          input
        ).pipe(
          Effect.mapError((cause) =>
            failure("invalidInput", "Invalid packing quantities.", cause)
          )
        );
        const order = yield* read(id);
        const detail = yield* project(order, locale);
        yield* validatePack(detail, command);
        const destination =
          order.shippingMode === "Multiple"
            ? order.shipping?.find(
                (group) => group.shippingKey === command.groupId
              )?.shippingAddress
            : order.shippingAddress;
        if (!destination) {
          return yield* failure(
            "configuration",
            "The selected fulfillment group has no destination address."
          );
        }
        return yield* write(
          order,
          [
            {
              action: "addDelivery",
              address: deliveryAddress(destination),
              items: command.items.map((item) => ({
                id: item.lineItemId,
                quantity: item.quantity,
              })),
              shippingKey:
                order.shippingMode === "Multiple" ? command.groupId : undefined,
            },
          ],
          locale
        );
      }),
    ship: (id, input, locale) =>
      Effect.gen(function* () {
        const command = yield* Schema.decodeEffect(ShipParcelInput)(input).pipe(
          Effect.mapError((cause) =>
            failure("invalidInput", "Invalid shipping quantities.", cause)
          )
        );
        const order = yield* read(id);
        const detail = yield* project(order, locale);
        yield* validateShip(detail, command);
        const selectedGroup = detail.groups.find((group) =>
          group.deliveries.some(
            (candidate) => candidate.id === command.deliveryId
          )
        );
        const fullyShipped = detail.groups.every((group) =>
          group.lines.every((line) => {
            const newlyShipped =
              group.id === selectedGroup?.id
                ? command.items
                    .filter((item) => item.lineItemId === line.id)
                    .reduce((sum, item) => sum + item.quantity, 0)
                : 0;
            return line.shipped + newlyShipped === line.ordered;
          })
        );
        return yield* write(
          order,
          [
            {
              action: "addParcelToDelivery",
              deliveryId: command.deliveryId,
              items: command.items.map((item) => ({
                id: item.lineItemId,
                quantity: item.quantity,
              })),
              trackingData: command.tracking
                ? {
                    carrier: command.tracking.carrier,
                    trackingId: command.tracking.number,
                  }
                : undefined,
            },
            {
              action: "changeShipmentState",
              shipmentState: fullyShipped ? "Shipped" : "Partial",
            },
          ],
          locale
        );
      }),
  });
};
export const orderFulfillmentLayer = Layer.unwrap(
  CommercetoolsRestClient.pipe(
    Effect.map(({ apiRoot }) => orderFulfillmentLayerFrom(apiRoot))
  )
);
