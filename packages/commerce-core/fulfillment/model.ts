import { Schema } from "effect";

import { OrderAddress, OrderLineItemId } from "../domain/order-history";
import { OrderId } from "../domain/order-identity";
import { StoreKey } from "../store";

export const FulfillmentRevision = Schema.NonEmptyString.pipe(
  Schema.brand("FulfillmentRevision")
);
export const FulfillmentGroupId = Schema.NonEmptyString.pipe(
  Schema.brand("FulfillmentGroupId")
);
export const DeliveryId = Schema.NonEmptyString.pipe(
  Schema.brand("DeliveryId")
);
export const ParcelId = Schema.NonEmptyString.pipe(Schema.brand("ParcelId"));
export const Quantity = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.makeFilter(Number.isSafeInteger)
);
export const DeliveryItem = Schema.Struct({
  lineItemId: OrderLineItemId,
  quantity: Quantity.check(Schema.isGreaterThan(0)),
});
export const DeliveryItems = Schema.NonEmptyArray(DeliveryItem).check(
  Schema.makeFilter(
    (items) =>
      new Set(items.map((item) => item.lineItemId)).size === items.length,
    { expected: "unique Order line items" }
  )
);
export const ParcelTracking = Schema.Struct({
  carrier: Schema.optional(Schema.NonEmptyString),
  number: Schema.optional(Schema.NonEmptyString),
});
export const Parcel = Schema.Struct({
  id: ParcelId,
  items: Schema.Array(DeliveryItem),
  tracking: Schema.optional(ParcelTracking),
});
export const Delivery = Schema.Struct({
  address: Schema.optional(OrderAddress),
  id: DeliveryId,
  items: Schema.Array(DeliveryItem),
  parcels: Schema.Array(Parcel),
});
export const FulfillmentLine = Schema.Struct({
  id: OrderLineItemId,
  name: Schema.String,
  ordered: Quantity,
  packed: Quantity,
  shipped: Quantity,
  sku: Schema.optional(Schema.String),
}).check(
  Schema.makeFilter(
    (line) => line.shipped <= line.packed && line.packed <= line.ordered,
    { expected: "shipped <= packed <= ordered" }
  )
);
export const FulfillmentGroup = Schema.Struct({
  address: Schema.optional(OrderAddress),
  deliveries: Schema.Array(Delivery),
  id: FulfillmentGroupId,
  lines: Schema.Array(FulfillmentLine),
  name: Schema.String,
});
export const FulfillmentOrder = Schema.Struct({
  cancelled: Schema.Boolean,
  groups: Schema.Array(FulfillmentGroup),
  id: OrderId,
  number: Schema.optional(Schema.String),
  revision: FulfillmentRevision,
  writable: Schema.Boolean,
});
export type FulfillmentOrder = typeof FulfillmentOrder.Type;
export const FulfillmentSummary = Schema.Struct({
  createdAt: Schema.String,
  id: OrderId,
  number: Schema.optional(Schema.String),
  storeKey: Schema.optional(StoreKey),
});
export const FulfillmentPage = Schema.Struct({
  items: Schema.Array(FulfillmentSummary),
  nextCursor: Schema.optional(Schema.NonEmptyString),
});
export type FulfillmentPage = typeof FulfillmentPage.Type;
export const FulfillmentListInput = Schema.Struct({
  after: Schema.optional(Schema.NonEmptyString),
  limit: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  orderNumber: Schema.optional(Schema.NonEmptyString),
});
export type FulfillmentListInput = typeof FulfillmentListInput.Type;
export const PackDeliveryInput = Schema.Struct({
  groupId: FulfillmentGroupId,
  items: DeliveryItems,
  revision: FulfillmentRevision,
});
export type PackDeliveryInput = typeof PackDeliveryInput.Type;
export const ShipParcelInput = Schema.Struct({
  deliveryId: DeliveryId,
  items: DeliveryItems,
  revision: FulfillmentRevision,
  tracking: Schema.optional(ParcelTracking),
});
export type ShipParcelInput = typeof ShipParcelInput.Type;

export class FulfillmentFailure extends Schema.TaggedError<FulfillmentFailure>()(
  "FulfillmentFailure",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    reason: Schema.Literals([
      "notFound",
      "conflict",
      "invalidInput",
      "invalidData",
      "unavailable",
      "outcomeUnknown",
      "configuration",
    ]),
  }
) {}
