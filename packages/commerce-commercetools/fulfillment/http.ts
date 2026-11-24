import type { AccessTokenVerifier } from "@repo/auth-contract/access-token";
import { fulfillmentAdminAuthenticationLayer } from "@repo/commerce-core/fulfillment/authentication";
import { makeFulfillmentHttpHandler } from "@repo/commerce-core/fulfillment/http";
import { Layer } from "effect";

import { commercetoolsFulfillmentLayer } from "./index";

/** Caller supplies the Admin identity verifier; native commerce credentials remain private. */
export const makeCommercetoolsFulfillmentHandler = <E>(
  authentication: Layer.Layer<AccessTokenVerifier, E>,
  basePath: `/${string}` = "/api/commerce/fulfillment"
) =>
  makeFulfillmentHttpHandler({
    authentication: fulfillmentAdminAuthenticationLayer.pipe(
      Layer.provide(authentication)
    ),
    basePath,
    fulfillment: commercetoolsFulfillmentLayer,
  });
