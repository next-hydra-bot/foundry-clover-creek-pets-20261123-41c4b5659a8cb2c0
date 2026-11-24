import { Effect } from "effect";

import { FulfillmentFailure } from "./model";
import type {
  FulfillmentOrder,
  PackDeliveryInput,
  ShipParcelInput,
} from "./model";

const reject = (message: string) =>
  new FulfillmentFailure({ message, reason: "invalidInput" });
export const validateFulfillmentWrite = (
  order: FulfillmentOrder,
  revision: string
) => {
  if (order.revision !== revision) {
    return Effect.fail(
      new FulfillmentFailure({
        message: "Order changed. Refresh before continuing.",
        reason: "conflict",
      })
    );
  }
  return order.writable && !order.cancelled
    ? Effect.void
    : Effect.fail(
        reject("This Order cannot be fulfilled in its current state.")
      );
};
export const validatePack = (
  order: FulfillmentOrder,
  input: PackDeliveryInput
) =>
  Effect.gen(function* () {
    yield* validateFulfillmentWrite(order, input.revision);
    const group = order.groups.find((item) => item.id === input.groupId);
    if (!group) {
      return yield* reject("Fulfillment group is unavailable.");
    }
    for (const item of input.items) {
      const line = group.lines.find(
        (candidate) => candidate.id === item.lineItemId
      );
      if (!line || item.quantity > line.ordered - line.packed) {
        return yield* reject(
          "Packing quantity exceeds the remaining Order allocation."
        );
      }
    }
  });
export const validateShip = (order: FulfillmentOrder, input: ShipParcelInput) =>
  Effect.gen(function* () {
    yield* validateFulfillmentWrite(order, input.revision);
    const delivery = order.groups
      .flatMap((group) => group.deliveries)
      .find((item) => item.id === input.deliveryId);
    if (!delivery) {
      return yield* reject("Delivery is unavailable.");
    }
    for (const item of input.items) {
      const allocation = delivery.items.find(
        (line) => line.lineItemId === item.lineItemId
      );
      const shipped = delivery.parcels
        .flatMap((parcel) => parcel.items)
        .filter((line) => line.lineItemId === item.lineItemId)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (!allocation || item.quantity > allocation.quantity - shipped) {
        return yield* reject(
          "Shipping quantity exceeds the remaining Delivery allocation."
        );
      }
    }
  });
