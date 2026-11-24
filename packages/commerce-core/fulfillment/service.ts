import type { Effect } from "effect";
import { Context } from "effect";

import type { OrderId } from "../domain/order-identity";
import type {
  FulfillmentFailure,
  FulfillmentListInput,
  FulfillmentOrder,
  FulfillmentPage,
  PackDeliveryInput,
  ShipParcelInput,
} from "./model";

/** Merchant operations, independent of buying flavor and the caller's UI host. */
export class OrderFulfillment extends Context.Service<
  OrderFulfillment,
  {
    readonly list: (
      input: FulfillmentListInput
    ) => Effect.Effect<FulfillmentPage, FulfillmentFailure>;
    readonly get: (
      id: OrderId,
      locale: string
    ) => Effect.Effect<FulfillmentOrder, FulfillmentFailure>;
    readonly pack: (
      id: OrderId,
      input: PackDeliveryInput,
      locale: string
    ) => Effect.Effect<FulfillmentOrder, FulfillmentFailure>;
    readonly ship: (
      id: OrderId,
      input: ShipParcelInput,
      locale: string
    ) => Effect.Effect<FulfillmentOrder, FulfillmentFailure>;
  }
>()("@repo/commerce-core/OrderFulfillment") {}
