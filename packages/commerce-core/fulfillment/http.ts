import { parseBearerAuthorization } from "@repo/auth-contract/http/bearer-token";
import { Permissions } from "@repo/auth-contract/permissions";
import type { InputInvalid } from "@repo/errors";
import { makeInputInvalid, makeSchemaErrorIssues } from "@repo/errors";
import { unexpectedHttpErrorsLayer } from "@repo/errors/http";
import { Effect, Layer } from "effect";
import type { Redacted } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";

import {
  FulfillmentHttpApi,
  FulfillmentManageAccess,
  FulfillmentReadAccess,
  FulfillmentSchemaErrors,
  FulfillmentServices,
  fulfillmentConflict,
  fulfillmentForbidden,
  fulfillmentMissing,
  fulfillmentOutcomeUnknown,
  fulfillmentUnauthorized,
  fulfillmentUnavailable,
} from "./api";
import { FulfillmentAuthentication } from "./authentication";
import type { FulfillmentFailure } from "./model";
import {
  FULFILLMENT_MANAGE_PERMISSION,
  FULFILLMENT_READ_PERMISSION,
  fulfillmentAuthorization,
} from "./permissions";
import { OrderFulfillment } from "./service";

type PublicFailure =
  | InputInvalid
  | typeof fulfillmentMissing.schema.Type
  | typeof fulfillmentConflict.schema.Type
  | typeof fulfillmentOutcomeUnknown.schema.Type
  | typeof fulfillmentUnavailable.schema.Type;
const failureResponse = (
  error: FulfillmentFailure
): Effect.Effect<never, PublicFailure> => {
  switch (error.reason) {
    case "invalidInput": {
      return Effect.fail(
        makeInputInvalid({
          issues: [{ message: error.message, path: [] }],
          message: error.message,
        })
      );
    }
    case "notFound": {
      return Effect.fail(
        fulfillmentMissing.make({ message: "Order not found." })
      );
    }
    case "conflict": {
      return Effect.fail(
        fulfillmentConflict.make({
          message: "Order changed. Refresh before continuing.",
        })
      );
    }
    case "outcomeUnknown": {
      return Effect.fail(
        fulfillmentOutcomeUnknown.make({
          message:
            "The write could not be confirmed. Refresh before trying again.",
        })
      );
    }
    case "unavailable": {
      return Effect.fail(
        fulfillmentUnavailable.make({
          message: "Fulfillment is temporarily unavailable.",
        })
      );
    }
    case "configuration":
    case "invalidData": {
      return Effect.die(error);
    }
    default: {
      return Effect.die(error);
    }
  }
};
const access = (
  permission: (typeof fulfillmentAuthorization.permissions)[number]
) =>
  Effect.gen(function* () {
    const authentication = yield* FulfillmentAuthentication;
    return {
      accessToken: <A, E, R>(
        program: Effect.Effect<A, E, R>,
        { credential }: { readonly credential: Redacted.Redacted }
      ) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const bearer = parseBearerAuthorization(
            request.headers.authorization,
            credential
          );
          if (bearer._tag !== "Token") {
            return yield* Effect.fail(
              fulfillmentUnauthorized.make({
                message: "Sign in to use fulfillment.",
              })
            );
          }
          const permissions = yield* authentication
            .authenticate({
              bearer: credential,
              headers: request.headers,
              url: request.url,
            })
            .pipe(
              Effect.mapError((error) =>
                error.reason === "unauthorized"
                  ? fulfillmentUnauthorized.make({
                      message: "Sign in to use fulfillment.",
                    })
                  : fulfillmentUnavailable.make({
                      message: "Authentication is unavailable.",
                    })
              )
            );
          const allowed = yield* fulfillmentAuthorization.has(permission).pipe(
            Effect.provideService(Permissions, permissions),
            Effect.mapError(() =>
              fulfillmentUnavailable.make({
                message: "Permission verification is unavailable.",
              })
            )
          );
          if (!allowed) {
            return yield* Effect.fail(
              fulfillmentForbidden.make({
                message:
                  "You do not have permission for this fulfillment operation.",
              })
            );
          }
          return yield* program;
        }),
    };
  });
export const makeFulfillmentHttpHandler = <E, E2>(dependencies: {
  readonly authentication: Layer.Layer<FulfillmentAuthentication, E>;
  readonly fulfillment: Layer.Layer<OrderFulfillment, E2>;
  readonly basePath?: `/${string}`;
}) => {
  const api = FulfillmentHttpApi.prefix(dependencies.basePath ?? "/");
  const handlers = HttpApiBuilder.group(api, "fulfillment", (group) =>
    group
      .handle("list", ({ query }) =>
        OrderFulfillment.pipe(
          Effect.flatMap((service) =>
            service.list({ ...query, limit: query.limit ?? 20 })
          ),
          Effect.catch(failureResponse)
        )
      )
      .handle("detail", ({ params, query }) =>
        OrderFulfillment.pipe(
          Effect.flatMap((service) => service.get(params.id, query.locale)),
          Effect.catch(failureResponse)
        )
      )
      .handle("pack", ({ params, payload, query }) =>
        OrderFulfillment.pipe(
          Effect.flatMap((service) =>
            service.pack(params.id, payload, query.locale)
          ),
          Effect.catch(failureResponse)
        )
      )
      .handle("ship", ({ params, payload, query }) =>
        OrderFulfillment.pipe(
          Effect.flatMap((service) =>
            service.ship(params.id, payload, query.locale)
          ),
          Effect.catch(failureResponse)
        )
      )
  );
  const transport = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(api).pipe(
      Layer.provide(handlers),
      Layer.provide(
        Layer.effect(
          FulfillmentServices,
          Effect.gen(function* () {
            const service = yield* OrderFulfillment;
            return FulfillmentServices.of((program) =>
              program.pipe(Effect.provideService(OrderFulfillment, service))
            );
          })
        )
      ),
      Layer.provide(
        Layer.effect(FulfillmentReadAccess, access(FULFILLMENT_READ_PERMISSION))
      ),
      Layer.provide(
        Layer.effect(
          FulfillmentManageAccess,
          access(FULFILLMENT_MANAGE_PERMISSION)
        )
      ),
      Layer.provide(
        HttpApiMiddleware.layerSchemaErrorTransform(
          FulfillmentSchemaErrors,
          (error) =>
            Effect.fail(
              makeInputInvalid({
                issues: makeSchemaErrorIssues(
                  error.cause,
                  "Invalid fulfillment input."
                ),
                message: "Invalid fulfillment input.",
              })
            )
        )
      ),
      Layer.provide(dependencies.fulfillment),
      Layer.provide(dependencies.authentication),
      Layer.provide(unexpectedHttpErrorsLayer),
      Layer.provide(HttpServer.layerServices),
      Layer.orDie
    )
  );
  return {
    dispose: transport.dispose,
    handler: async (request: Request) => {
      const response = await transport.handler(request);
      response.headers.set("cache-control", "private, no-store");
      return response;
    },
  };
};
