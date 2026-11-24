import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { OrderId } from "@repo/commerce-core/domain/order-identity";
import type { FulfillmentFailure } from "@repo/commerce-core/fulfillment/model";
import {
  PackDeliveryInput,
  ShipParcelInput,
} from "@repo/commerce-core/fulfillment/model";
import { OrderFulfillment } from "@repo/commerce-core/fulfillment/service";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { orderFulfillmentLayerFrom } from "./fulfillment";

const Item = Schema.Struct({ id: Schema.String, quantity: Schema.Int });
const Tracking = Schema.Struct({
  carrier: Schema.optional(Schema.String),
  trackingId: Schema.optional(Schema.String),
});
const NativeAddress = Schema.Struct({
  city: Schema.optional(Schema.String),
  country: Schema.String,
  key: Schema.optional(Schema.String),
  postalCode: Schema.optional(Schema.String),
  streetName: Schema.optional(Schema.String),
  streetNumber: Schema.optional(Schema.String),
});
const Parcel = Schema.Struct({
  createdAt: Schema.String,
  id: Schema.String,
  items: Schema.optional(Schema.Array(Item)),
  trackingData: Schema.optional(Tracking),
});
const Delivery = Schema.Struct({
  address: Schema.optional(NativeAddress),
  createdAt: Schema.String,
  id: Schema.String,
  items: Schema.Array(Item),
  parcels: Schema.Array(Parcel),
});
const Update = Schema.Struct({
  actions: Schema.Array(
    Schema.Union([
      Schema.Struct({
        action: Schema.Literal("addDelivery"),
        address: NativeAddress,
        items: Schema.Array(Item),
        shippingKey: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        action: Schema.Literal("addParcelToDelivery"),
        deliveryId: Schema.String,
        items: Schema.Array(Item),
        trackingData: Schema.optional(Tracking),
      }),
      Schema.Struct({
        action: Schema.Literal("changeShipmentState"),
        shipmentState: Schema.String,
      }),
    ])
  ),
  version: Schema.Int,
});
const id = OrderId.make("order-1");
const pack = (revision: string, quantity: number) =>
  Schema.decodeSync(PackDeliveryInput)({
    groupId: "default",
    items: [{ lineItemId: "line-1", quantity }],
    revision,
  });
const ship = (revision: string, quantity: number) =>
  Schema.decodeSync(ShipParcelInput)({
    deliveryId: "delivery-1",
    items: [{ lineItemId: "line-1", quantity }],
    revision,
    tracking: { carrier: "Carrier", number: "TRACK-1" },
  });
interface NativeLine {
  readonly id: string;
  readonly name: Record<string, string>;
  readonly quantity: number;
  readonly variant?: { readonly sku: string };
  readonly shippingDetails?: {
    readonly targets: readonly {
      readonly addressKey: string;
      readonly quantity: number;
      readonly shippingMethodKey: string;
    }[];
  };
}
const fixture = (multiple = false, custom = false) => {
  const deliveries: (typeof Delivery.Type)[] = [];
  const targets = {
    targets: [
      { addressKey: "east", quantity: 2, shippingMethodKey: "east" },
      { addressKey: "west", quantity: 2, shippingMethodKey: "west" },
    ],
  };
  const item: NativeLine = {
    id: "line-1",
    name: { "en-US": "Machine" },
    quantity: 4,
  };
  if (multiple) {
    Object.assign(item, { shippingDetails: targets });
  }
  const lineItems: NativeLine[] = custom
    ? []
    : [{ ...item, variant: { sku: "MACHINE" } }];
  const customLineItems: NativeLine[] = custom ? [item] : [];
  const shipping: {
    shippingAddress: typeof NativeAddress.Type;
    shippingInfo: {
      deliveries: (typeof Delivery.Type)[];
      shippingMethodName: string;
    };
    shippingKey: string;
  }[] = [];
  if (multiple) {
    for (const shippingKey of ["east", "west"]) {
      shipping.push({
        shippingAddress: {
          country: "US",
          key: shippingKey,
          streetName: shippingKey === "east" ? "East Road" : "West Road",
        },
        shippingInfo: { deliveries: [], shippingMethodName: shippingKey },
        shippingKey,
      });
    }
  }
  const native = {
    createdAt: "2026-11-02T00:00:00Z",
    customLineItems,
    id,
    lineItems,
    orderState: "Confirmed",
    shipmentState: "Pending",
    shipping,
    shippingAddress: {
      city: "Boston",
      country: "US",
      key: "main",
      postalCode: "02110",
      streetName: "Market Street",
      streetNumber: "42",
    },
    shippingInfo: { deliveries, shippingMethodName: "Ground" },
    shippingMode: multiple ? "Multiple" : "Single",
    version: 1,
  };
  const writes: (typeof Update.Type)[] = [];
  let conflict = false;
  let uncertain = false;
  const root = createApiBuilderFromCtpClient({
    execute: async (request: {
      readonly method: string;
      readonly body?: unknown;
    }) => {
      if (request.method === "POST") {
        const update = Schema.decodeUnknownSync(Update)(request.body);
        if (conflict || update.version !== native.version) {
          throw Object.assign(new Error("Changed"), { statusCode: 409 });
        }
        for (const action of update.actions) {
          if (action.action === "addDelivery") {
            (action.shippingKey
              ? (native.shipping.find(
                  (group) => group.shippingKey === action.shippingKey
                )?.shippingInfo.deliveries ?? [])
              : native.shippingInfo.deliveries
            ).push({
              address: action.address,
              createdAt: native.createdAt,
              id: `delivery-${writes.length + 1}`,
              items: [...action.items],
              parcels: [],
            });
          } else if (action.action === "addParcelToDelivery") {
            const delivery = [
              ...native.shippingInfo.deliveries,
              ...native.shipping.flatMap(
                (group) => group.shippingInfo.deliveries
              ),
            ].find((candidate) => candidate.id === action.deliveryId);
            Object.assign(delivery ?? {}, {
              parcels: [
                ...(delivery?.parcels ?? []),
                {
                  createdAt: native.createdAt,
                  id: "parcel-1",
                  items: action.items,
                  trackingData: action.trackingData,
                },
              ],
            });
          } else {
            native.shipmentState = action.shipmentState;
          }
        }
        native.version += 1;
        writes.push(update);
        if (uncertain) {
          throw new Error("Connection reset after accepting write");
        }
      }
      return await Promise.resolve({
        body: structuredClone(native),
        statusCode: 200,
      });
    },
  }).withProjectKey({ projectKey: "project" });
  const layer = orderFulfillmentLayerFrom(root);
  const run = async <A>(
    program: Effect.Effect<A, FulfillmentFailure, OrderFulfillment>
  ) => await Effect.runPromise(program.pipe(Effect.provide(layer)));
  return {
    native,
    run,
    setConflict: () => {
      conflict = true;
    },
    setUncertain: () => {
      uncertain = true;
    },
    writes,
  };
};
describe("commercetools fulfillment", () => {
  it("packs and ships partial quantities and changes native shipment state atomically", async () => {
    const f = fixture();
    await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.pack(id, pack("1", 4), "en-US"))
      )
    );
    const partial = await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.ship(id, ship("2", 2), "en-US"))
      )
    );
    expect(partial.groups[0]?.lines[0]).toMatchObject({
      ordered: 4,
      packed: 4,
      shipped: 2,
    });
    expect(f.writes[1]?.actions).toMatchObject([
      { action: "addParcelToDelivery" },
      { action: "changeShipmentState", shipmentState: "Partial" },
    ]);
    const completed = await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.ship(id, ship("3", 2), "en-US"))
      )
    );
    expect(completed.groups[0]?.lines[0]?.shipped).toBe(4);
    expect(f.native.shipmentState).toBe("Shipped");
  });

  it("records the delivery destination independently of later Order address changes", async () => {
    const f = fixture();
    await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.pack(id, pack("1", 2), "en-US"))
      )
    );
    expect(f.writes[0]?.actions[0]).toMatchObject({
      address: {
        city: "Boston",
        country: "US",
        streetName: "42 Market Street",
      },
    });
    Object.assign(f.native.shippingAddress, {
      streetName: "Changed Street",
      streetNumber: "9",
    });
    f.native.version += 1;
    const detail = await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.get(id, "en-US"))
      )
    );
    expect(detail.groups[0]?.address?.addressLine1).toBe("9 Changed Street");
    expect(detail.groups[0]?.deliveries[0]?.address?.addressLine1).toBe(
      "42 Market Street"
    );
  });

  it("rejects overpacking and overshipping without a native write", async () => {
    const f = fixture();
    await expect(
      f.run(
        OrderFulfillment.pipe(
          Effect.flatMap((service) => service.pack(id, pack("1", 5), "en-US"))
        )
      )
    ).rejects.toMatchObject({ reason: "invalidInput" });
    await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.pack(id, pack("1", 2), "en-US"))
      )
    );
    await expect(
      f.run(
        OrderFulfillment.pipe(
          Effect.flatMap((service) => service.ship(id, ship("2", 3), "en-US"))
        )
      )
    ).rejects.toMatchObject({ reason: "invalidInput" });
    expect(f.writes).toHaveLength(1);
  });

  it("requires a refreshed revision and reports native concurrent updates", async () => {
    const f = fixture();
    await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.pack(id, pack("1", 1), "en-US"))
      )
    );
    await expect(
      f.run(
        OrderFulfillment.pipe(
          Effect.flatMap((service) => service.pack(id, pack("1", 1), "en-US"))
        )
      )
    ).rejects.toMatchObject({ reason: "conflict" });
    f.setConflict();
    await expect(
      f.run(
        OrderFulfillment.pipe(
          Effect.flatMap((service) => service.pack(id, pack("2", 1), "en-US"))
        )
      )
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(f.writes).toHaveLength(1);
  });

  it("allows only one of two simultaneous operators to consume the same allocation", async () => {
    const f = fixture();
    const update = OrderFulfillment.pipe(
      Effect.flatMap((service) => service.pack(id, pack("1", 3), "en-US"))
    );
    const results = await Promise.allSettled([f.run(update), f.run(update)]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const refreshed = await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.get(id, "en-US"))
      )
    );
    expect(refreshed.groups[0]?.lines[0]?.packed).toBe(3);
    expect(f.writes).toHaveLength(1);
  });

  it("reports an accepted write with a lost response as outcome unknown", async () => {
    const f = fixture();
    f.setUncertain();
    await expect(
      f.run(
        OrderFulfillment.pipe(
          Effect.flatMap((service) => service.pack(id, pack("1", 1), "en-US"))
        )
      )
    ).rejects.toMatchObject({ reason: "outcomeUnknown" });
    const refreshed = await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.get(id, "en-US"))
      )
    );
    expect(refreshed.groups[0]?.lines[0]?.packed).toBe(1);
    expect(refreshed.revision).toBe("2");
  });

  it("keeps native multiple-shipping allocations separate", async () => {
    const f = fixture(true);
    const east = Schema.decodeSync(PackDeliveryInput)({
      ...pack("1", 2),
      groupId: "east",
    });
    await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.pack(id, east, "en-US"))
      )
    );
    const detail = await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.ship(id, ship("2", 2), "en-US"))
      )
    );
    expect(
      detail.groups.map((group) => ({
        id: group.id,
        packed: group.lines[0]?.packed,
        shipped: group.lines[0]?.shipped,
      }))
    ).toEqual([
      { id: "east", packed: 2, shipped: 2 },
      { id: "west", packed: 0, shipped: 0 },
    ]);
    expect(f.native.shipmentState).toBe("Partial");
    expect(detail.groups[0]?.deliveries[0]?.address?.addressLine1).toBe(
      "East Road"
    );
  });

  it("fulfills custom Order lines without requiring a catalog variant", async () => {
    const f = fixture(false, true);
    const detail = await f.run(
      OrderFulfillment.pipe(
        Effect.flatMap((service) => service.pack(id, pack("1", 2), "en-US"))
      )
    );
    expect(detail.groups[0]?.lines[0]).toMatchObject({
      id: "line-1",
      name: "Machine",
      packed: 2,
    });
  });

  it("refuses to invent quantities for an externally created Parcel", async () => {
    const f = fixture();
    f.native.shippingInfo.deliveries.push({
      createdAt: f.native.createdAt,
      id: "delivery-1",
      items: [{ id: "line-1", quantity: 1 }],
      parcels: [{ createdAt: f.native.createdAt, id: "parcel-1" }],
    });
    await expect(
      f.run(
        OrderFulfillment.pipe(
          Effect.flatMap((service) => service.get(id, "en-US"))
        )
      )
    ).rejects.toMatchObject({ reason: "invalidData" });
  });
});
