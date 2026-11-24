import { Layer } from "effect";

import { commercetoolsRestClientLayer } from "../client/layers";
import { orderFulfillmentLayer } from "./fulfillment";

export const commercetoolsFulfillmentLayer = orderFulfillmentLayer.pipe(
  Layer.provide(commercetoolsRestClientLayer)
);
