import type { PermissionAdapter } from "@repo/auth-contract/permissions";
import { makeAddressBookApiGroup } from "@repo/commerce-core/http/address-book-api";
import { makeCartApiGroup } from "@repo/commerce-core/http/cart-api";
import { CommerceRequestHeaders } from "@repo/commerce-core/http/commerce-request";
import { makeOrderApiGroup } from "@repo/commerce-core/http/order-api";
import { makeProductApiGroup } from "@repo/commerce-core/http/product-api";
import type { CommerceBaseRequestServices } from "@repo/commerce-core/runtime/make-commerce-base-app";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { definePublicError, InputInvalid } from "@repo/errors";
import { UnexpectedHttpErrors } from "@repo/errors/http";
import {
  HttpApi,
  HttpApiMiddleware,
  HttpApiSecurity,
  OpenApi,
} from "effect/http-api";

export const commerceUnauthorized = definePublicError({
  category: "unauthenticated",
  code: "auth.unauthorized",
  fields: {},
  recovery: "reauthenticate",
  status: 401,
  tag: "CommerceApiUnauthorized",
});
export const commerceForbidden = definePublicError({
  category: "forbidden",
  code: "commerce.accessDenied",
  fields: {},
  recovery: "request_access",
  status: 403,
  tag: "CommerceApiForbidden",
});
export const commerceUnavailable = definePublicError({
  category: "unavailable",
  code: "commerce.unavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "CommerceApiUnavailable",
});

export class CommerceHttpSession extends HttpApiMiddleware.Service<
  CommerceHttpSession,
  {
    readonly provides: CommerceBaseRequestServices | PermissionAdapter;
    readonly requires: never;
  }
>()("@repo/commerce-commercetools/http/Session", {
  error: [
    InputInvalid,
    commerceUnauthorized.schema,
    commerceForbidden.schema,
    commerceUnavailable.schema,
  ],
  security: { accessToken: HttpApiSecurity.bearer },
}) {}

/** Account authority is independent of the shopping Store, Cart and Product Discovery. */
export class CommerceHttpAccountSession extends HttpApiMiddleware.Service<
  CommerceHttpAccountSession,
  {
    readonly provides: CommerceContext | PermissionAdapter;
    readonly requires: never;
  }
>()("@repo/commerce-commercetools/http/AccountSession", {
  error: [
    InputInvalid,
    commerceUnauthorized.schema,
    commerceForbidden.schema,
    commerceUnavailable.schema,
  ],
  security: { accessToken: HttpApiSecurity.bearer },
}) {}

export class CommerceHttpSchemaErrors extends HttpApiMiddleware.Service<CommerceHttpSchemaErrors>()(
  "@repo/commerce-commercetools/http/SchemaErrors",
  { error: InputInvalid }
) {}

const optionalAccessToken = OpenApi.annotations({
  transform: (operation) => {
    const security: unknown[] = [{}];
    const configured: unknown = operation.security;
    if (Array.isArray(configured)) {
      for (const requirement of configured) {
        security.push(requirement);
      }
    }
    return { ...operation, security };
  },
});

/** Context and authentication are shared by catalog reads and cart mutations. */
export class CommercetoolsCommerceHttpApi extends HttpApi.make("commerce-api")
  .add(
    makeCartApiGroup(CommerceRequestHeaders)
      .middleware(CommerceHttpSession)
      .annotateEndpointsMerge(optionalAccessToken)
  )
  .add(
    makeProductApiGroup(CommerceRequestHeaders)
      .middleware(CommerceHttpSession)
      .annotateEndpointsMerge(optionalAccessToken)
  )
  .add(
    makeOrderApiGroup(CommerceRequestHeaders).middleware(
      CommerceHttpAccountSession
    )
  )
  .add(
    makeAddressBookApiGroup(CommerceRequestHeaders).middleware(
      CommerceHttpAccountSession
    )
  )
  .middleware(CommerceHttpSchemaErrors)
  .middleware(UnexpectedHttpErrors)
  .annotateMerge(
    OpenApi.annotations({ title: "Commerce", version: "1.0.0" })
  ) {}
