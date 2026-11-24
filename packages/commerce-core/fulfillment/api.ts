/* oxlint-disable max-classes-per-file -- The two operation permissions belong to one HTTP contract. */
import { definePublicError, InputInvalid } from "@repo/errors";
import { UnexpectedHttpErrors } from "@repo/errors/http";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
  OpenApi,
} from "effect/http-api";

import { OrderId } from "../domain/order-identity";
import {
  FulfillmentOrder,
  FulfillmentPage,
  PackDeliveryInput,
  ShipParcelInput,
} from "./model";
import type { OrderFulfillment } from "./service";

export const fulfillmentUnauthorized = definePublicError({
  category: "unauthenticated",
  code: "auth.unauthorized",
  fields: {},
  recovery: "reauthenticate",
  status: 401,
  tag: "FulfillmentApiUnauthorized",
});
export const fulfillmentForbidden = definePublicError({
  category: "forbidden",
  code: "fulfillment.accessDenied",
  fields: {},
  recovery: "request_access",
  status: 403,
  tag: "FulfillmentApiForbidden",
});
export const fulfillmentMissing = definePublicError({
  category: "not_found",
  code: "fulfillment.notFound",
  fields: {},
  recovery: "none",
  status: 404,
  tag: "FulfillmentApiNotFound",
});
export const fulfillmentConflict = definePublicError({
  category: "conflict",
  code: "fulfillment.conflict",
  fields: {},
  recovery: "refresh",
  status: 409,
  tag: "FulfillmentApiConflict",
});
export const fulfillmentOutcomeUnknown = definePublicError({
  category: "conflict",
  code: "fulfillment.outcomeUnknown",
  fields: {},
  recovery: "refresh",
  status: 409,
  tag: "FulfillmentApiOutcomeUnknown",
});
export const fulfillmentUnavailable = definePublicError({
  category: "unavailable",
  code: "fulfillment.unavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "FulfillmentApiUnavailable",
});
const accessErrors = [
  fulfillmentUnauthorized.schema,
  fulfillmentForbidden.schema,
  fulfillmentUnavailable.schema,
];
export class FulfillmentReadAccess extends HttpApiMiddleware.Service<FulfillmentReadAccess>()(
  "@repo/commerce-core/FulfillmentReadAccess",
  { error: accessErrors, security: { accessToken: HttpApiSecurity.bearer } }
) {}
export class FulfillmentManageAccess extends HttpApiMiddleware.Service<FulfillmentManageAccess>()(
  "@repo/commerce-core/FulfillmentManageAccess",
  { error: accessErrors, security: { accessToken: HttpApiSecurity.bearer } }
) {}
export class FulfillmentServices extends HttpApiMiddleware.Service<
  FulfillmentServices,
  { readonly provides: OrderFulfillment; readonly requires: never }
>()("@repo/commerce-core/FulfillmentServices", {}) {}
export class FulfillmentSchemaErrors extends HttpApiMiddleware.Service<FulfillmentSchemaErrors>()(
  "@repo/commerce-core/FulfillmentSchemaErrors",
  { error: InputInvalid }
) {}

const LocaleQuery = Schema.Struct({ locale: Schema.NonEmptyString });
const params = Schema.Struct({ id: OrderId });
const errors = [
  InputInvalid,
  fulfillmentMissing.schema,
  fulfillmentConflict.schema,
  fulfillmentOutcomeUnknown.schema,
  fulfillmentUnavailable.schema,
];
export class FulfillmentHttpApi extends HttpApi.make("fulfillment-api")
  .add(
    HttpApiGroup.make("fulfillment")
      .add(
        HttpApiEndpoint.get("list", "/orders", {
          error: errors,
          query: Schema.Struct({
            after: Schema.optionalKey(Schema.NonEmptyString),
            limit: Schema.optionalKey(
              Schema.FiniteFromString.check(
                Schema.isInt(),
                Schema.isBetween({ maximum: 100, minimum: 1 })
              )
            ),
            orderNumber: Schema.optionalKey(Schema.NonEmptyString),
          }),
          success: FulfillmentPage,
        }).middleware(FulfillmentReadAccess)
      )
      .add(
        HttpApiEndpoint.get("detail", "/orders/:id", {
          error: errors,
          params,
          query: LocaleQuery,
          success: FulfillmentOrder,
        }).middleware(FulfillmentReadAccess)
      )
      .add(
        HttpApiEndpoint.post("pack", "/orders/:id/deliveries", {
          error: errors,
          params,
          payload: PackDeliveryInput,
          query: LocaleQuery,
          success: FulfillmentOrder,
        }).middleware(FulfillmentManageAccess)
      )
      .add(
        HttpApiEndpoint.post("ship", "/orders/:id/parcels", {
          error: errors,
          params,
          payload: ShipParcelInput,
          query: LocaleQuery,
          success: FulfillmentOrder,
        }).middleware(FulfillmentManageAccess)
      )
  )
  .middleware(FulfillmentServices)
  .middleware(FulfillmentSchemaErrors)
  .middleware(UnexpectedHttpErrors)
  .annotateMerge(
    OpenApi.annotations({ title: "Order fulfillment", version: "1.0.0" })
  ) {}
