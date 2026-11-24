import type { VerifiedAccessToken } from "@repo/auth-contract/access-token";
import { AccessTokenVerifier } from "@repo/auth-contract/access-token";
import { accessTokenPermissionAdapterLayer } from "@repo/auth-contract/permissions";
import type { PermissionAdapter } from "@repo/auth-contract/permissions";
import { CartId } from "@repo/commerce-core/domain/cart";
import { currentCartOperationFailure } from "@repo/commerce-core/domain/cart-errors";
import {
  AnonymousCommerceContextRequest,
  AuthUserId,
  B2CPurchasingContextRequest,
  CustomerCommerceContextRequest,
} from "@repo/commerce-core/domain/commerce-request-context";
import { addressBookHttpPrograms } from "@repo/commerce-core/http/address-book-api";
import { cartHttpPrograms } from "@repo/commerce-core/http/cart-api";
import { CommerceRequestHeaders } from "@repo/commerce-core/http/commerce-request";
import {
  orderHttpPrograms,
  orderHttpQueriesLayer,
} from "@repo/commerce-core/http/order-api";
import type { OrderHttpPrograms } from "@repo/commerce-core/http/order-api";
import { productHttpPrograms } from "@repo/commerce-core/http/product-api";
import {
  ANONYMOUS_CART_COOKIE_NAME,
  encodeAnonymousCartCookie,
  getAnonymousCartIdFromCookieValue,
  makeAnonymousCartCookie,
} from "@repo/commerce-core/lib/cart/utils/anonymous-cart-cookies";
import type { CommerceRequestInput } from "@repo/commerce-core/runtime/commerce-request";
import type {
  CommerceBaseApplication,
  CommerceRequestProvisionError,
  CommerceBaseStableServices,
} from "@repo/commerce-core/runtime/make-commerce-base-app";
import type { AddressBook } from "@repo/commerce-core/services/address-book";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { OrderQueries } from "@repo/commerce-core/services/order-queries";
import { resolveStore } from "@repo/commerce-core/store";
import { makeInputInvalid, makeSchemaErrorIssues } from "@repo/errors";
import { unexpectedHttpErrorsLayer } from "@repo/errors/http";
import { Duration, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";
import type { Config } from "effect";
import {
  HttpEffect,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";

import { addressBookLayer } from "../address-book";
import { commercetoolsRestClientLayer } from "../client/layers";
import { orderQueriesLayer } from "../orders/queries";
import {
  CommercetoolsAccountContext,
  accountContextLayer,
} from "./account-context";
import {
  commerceForbidden,
  commerceUnauthorized,
  commerceUnavailable,
  CommerceHttpSchemaErrors,
  CommerceHttpSession,
  CommerceHttpAccountSession,
  CommercetoolsCommerceHttpApi,
} from "./api";

export interface CommerceHttpDependencies<
  StableServices = CommerceBaseStableServices,
> {
  readonly permissionAdapterLayer?: (
    token: VerifiedAccessToken | undefined
  ) => Layer.Layer<PermissionAdapter>;
  readonly authenticationLayer: Layer.Layer<
    AccessTokenVerifier,
    Config.ConfigError
  >;
  readonly commerceApp: CommerceBaseApplication<
    Config.ConfigError,
    Config.ConfigError | CommerceRequestProvisionError,
    StableServices
  >;
  readonly orderPrograms: OrderHttpPrograms;
  readonly purchasingMode: "b2c" | "b2b" | "blended";
  readonly accountContextLayer?: Layer.Layer<
    CommercetoolsAccountContext,
    Config.ConfigError
  >;
  readonly addressBookLayer?: Layer.Layer<
    AddressBook,
    Config.ConfigError,
    CommerceContext
  >;
  readonly ordersLayer?: Layer.Layer<OrderQueries, Config.ConfigError>;
  readonly basePath?: `/${string}`;
}

const invalidInput = (cause: Schema.SchemaError) =>
  makeInputInvalid({
    issues: makeSchemaErrorIssues(cause, "The commerce request is invalid."),
    message: "The commerce request is invalid.",
  });
const unauthorized = () =>
  commerceUnauthorized.make({ message: "Valid authentication is required." });
const forbidden = () =>
  commerceForbidden.make({
    message: "This purchasing context is inaccessible.",
  });
const unavailable = () =>
  commerceUnavailable.make({ message: "Commerce is temporarily unavailable." });

const requestInput = (
  headers: CommerceRequestHeaders,
  authUserId: AuthUserId | undefined
) =>
  Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const store = resolveStore({ locale: headers["x-context-locale"] });
    const businessUnitId = headers["x-context-business-unit-id"];
    const personal = headers["x-context-purchasing-context"] === "personal";
    if (
      (personal && businessUnitId !== undefined) ||
      (authUserId === undefined &&
        (businessUnitId !== undefined ||
          headers["x-context-purchasing-context"] === "company")) ||
      (authUserId !== undefined && !personal && businessUnitId === undefined)
    ) {
      return yield* Effect.fail(forbidden());
    }
    if (authUserId !== undefined) {
      return {
        context: personal
          ? new B2CPurchasingContextRequest({ authUserId, store })
          : new CustomerCommerceContextRequest({
              authUserId,
              businessUnitId,
              store,
            }),
        currentCartCookie: { clear: () => Effect.void, set: () => Effect.void },
      } satisfies CommerceRequestInput;
    }
    const changes = yield* Ref.make(Option.none<string | null>());
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Ref.get(changes).pipe(
        Effect.map(
          Option.match({
            onNone: () => response,
            onSome: (value) =>
              value === null
                ? HttpServerResponse.expireCookieUnsafe(
                    response,
                    ANONYMOUS_CART_COOKIE_NAME,
                    { path: "/" }
                  )
                : HttpServerResponse.setCookieUnsafe(
                    response,
                    ANONYMOUS_CART_COOKIE_NAME,
                    value,
                    {
                      httpOnly: true,
                      maxAge: Duration.days(90),
                      path: "/",
                      sameSite: "lax",
                      secure: process.env.NODE_ENV === "production",
                    }
                  ),
          })
        )
      )
    );
    const anonymousCartId = getAnonymousCartIdFromCookieValue(
      incoming.cookies[ANONYMOUS_CART_COOKIE_NAME],
      store
    );
    return {
      context: new AnonymousCommerceContextRequest({
        anonymousCartId:
          anonymousCartId === null ? undefined : CartId.make(anonymousCartId),
        store,
      }),
      currentCartCookie: {
        clear: () => Ref.set(changes, Option.some(null)),
        set: (cartId) =>
          Effect.try({
            catch: currentCartOperationFailure,
            try: () =>
              encodeAnonymousCartCookie(
                makeAnonymousCartCookie({ cartId, store })
              ),
          }).pipe(
            Effect.flatMap((value) => Ref.set(changes, Option.some(value)))
          ),
      },
    } satisfies CommerceRequestInput;
  });

const requestIdentity = (
  verifier: AccessTokenVerifier["Service"],
  credential: Redacted.Redacted
) =>
  Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        HttpServerResponse.setHeader(
          response,
          "cache-control",
          "private, no-store"
        )
      )
    );
    const headers = yield* Schema.decodeUnknownEffect(CommerceRequestHeaders)({
      "x-context-business-unit-id":
        incoming.headers["x-context-business-unit-id"],
      "x-context-locale": incoming.headers["x-context-locale"],
      "x-context-purchasing-context":
        incoming.headers["x-context-purchasing-context"],
    }).pipe(Effect.mapError(invalidInput));
    let authUserId: AuthUserId | undefined;
    let authentication: VerifiedAccessToken | undefined;
    const { authorization } = incoming.headers;
    if (authorization !== undefined) {
      const token = /^Bearer[\t ]+(?<token>[^\s,]+)[\t ]*$/iu.exec(
        authorization
      )?.groups?.token;
      if (!token || token !== Redacted.value(credential)) {
        return yield* Effect.fail(unauthorized());
      }
      const verified = yield* verifier.verify(token).pipe(
        Effect.catchTags({
          AccessTokenInvalid: () => Effect.fail(unauthorized()),
          AccessTokenVerificationFailure: (error) =>
            error.reason === "unavailable"
              ? Effect.fail(unavailable())
              : Effect.die(error),
        })
      );
      authentication = verified;
      authUserId = AuthUserId.make(verified.authUserId);
    }
    return { authUserId, authentication, headers };
  });

const sessionLayer = <StableServices>({
  commerceApp,
  permissionAdapterLayer = accessTokenPermissionAdapterLayer,
}: CommerceHttpDependencies<StableServices>) =>
  Layer.effect(
    CommerceHttpSession,
    Effect.gen(function* () {
      const services = yield* Effect.context<StableServices>();
      const verifier = yield* AccessTokenVerifier;
      return {
        accessToken: (program, { credential }) =>
          Effect.gen(function* () {
            const { headers, authentication, authUserId } =
              yield* requestIdentity(verifier, credential);
            const request = yield* requestInput(headers, authUserId);
            return yield* program.pipe(
              Effect.provide(permissionAdapterLayer(authentication)),
              commerceApp.provide(request),
              Effect.provide(services),
              Effect.catchTags({
                CommerceAccountUnavailable: () => Effect.fail(unavailable()),
                CommerceRequestContextNotFound: () => Effect.fail(forbidden()),
                ConfigError: (error) => Effect.die(error),
              })
            );
          }),
      };
    })
  );

const accountSessionLayer = <Services>(
  dependencies: CommerceHttpDependencies<Services>
) =>
  Layer.effect(
    CommerceHttpAccountSession,
    Effect.gen(function* () {
      const resolver = yield* CommercetoolsAccountContext;
      const verifier = yield* AccessTokenVerifier;
      return {
        accessToken: (program, { credential }) =>
          Effect.gen(function* () {
            const { headers, authentication } = yield* requestIdentity(
              verifier,
              credential
            );
            if (authentication === undefined) {
              return yield* Effect.fail(unauthorized());
            }
            const request = yield* requestInput(
              headers,
              authentication.authUserId
            );
            const personal =
              request.context._tag === "B2CPurchasingContextRequest";
            if (
              dependencies.purchasingMode !== "blended" &&
              personal !== (dependencies.purchasingMode === "b2c")
            ) {
              return yield* Effect.fail(forbidden());
            }
            const context = yield* resolver.resolve(request.context).pipe(
              Effect.catchTags({
                CommerceAccountUnavailable: () => Effect.fail(unavailable()),
                CommerceRequestContextNotFound: () => Effect.fail(forbidden()),
              })
            );
            return yield* program.pipe(
              Effect.provideService(CommerceContext, context),
              Effect.provide(
                (
                  dependencies.permissionAdapterLayer ??
                  accessTokenPermissionAdapterLayer
                )(authentication)
              )
            );
          }),
      };
    })
  );

export const makeCommerceHttpHandler = <StableServices>(
  dependencies: CommerceHttpDependencies<StableServices>
) => {
  const api = CommercetoolsCommerceHttpApi.prefix(dependencies.basePath ?? "/");
  const cartHandlers = HttpApiBuilder.group(api, "cart", (handlers) =>
    handlers
      .handle("current", () => cartHttpPrograms.current)
      .handle("addItem", ({ payload }) => cartHttpPrograms.addItem(payload))
      .handle("changeDiscountCode", ({ payload }) =>
        cartHttpPrograms.changeDiscountCode(payload)
      )
      .handle("setQuantity", ({ payload }) =>
        cartHttpPrograms.setQuantity(payload)
      )
      .handle("removeItem", ({ payload }) =>
        cartHttpPrograms.removeItem(payload)
      )
  );
  const catalogHandlers = HttpApiBuilder.group(api, "catalog", (handlers) =>
    handlers
      .handle("list", ({ query }) => productHttpPrograms.list(query))
      .handle("detail", ({ params }) => productHttpPrograms.detail(params.slug))
  );

  const orders = orderHttpPrograms(dependencies.orderPrograms);
  const orderHandlers = HttpApiBuilder.group(api, "orders", (handlers) =>
    handlers
      .handle("list", ({ query }) => orders.list(query))
      .handle("detail", ({ params, query }) => orders.detail(params.id, query))
  );
  const addressHandlers = HttpApiBuilder.group(api, "addressBook", (handlers) =>
    handlers.handle("list", () =>
      addressBookHttpPrograms.list.pipe(
        Effect.provide(dependencies.addressBookLayer ?? addressBookLayer),
        Effect.catchTag("ConfigError", (error) => Effect.die(error))
      )
    )
  );
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(api).pipe(
      Layer.provide(addressHandlers),
      Layer.provide(orderHandlers),
      Layer.provide(orderHttpQueriesLayer),
      Layer.provide(
        dependencies.ordersLayer ??
          orderQueriesLayer.pipe(Layer.provide(commercetoolsRestClientLayer))
      ),
      Layer.provide(cartHandlers),
      Layer.provide(catalogHandlers),
      Layer.provide(
        HttpApiMiddleware.layerSchemaErrorTransform(
          CommerceHttpSchemaErrors,
          (error) => Effect.fail(invalidInput(error.cause))
        )
      ),
      Layer.provide(sessionLayer(dependencies)),
      Layer.provide(accountSessionLayer(dependencies)),
      Layer.provide(dependencies.accountContextLayer ?? accountContextLayer),
      Layer.provide(unexpectedHttpErrorsLayer),
      Layer.provide(dependencies.authenticationLayer),
      Layer.provide(dependencies.commerceApp.layer),
      Layer.provide(HttpServer.layerServices)
    ),
    { disableLogger: true }
  );
};
