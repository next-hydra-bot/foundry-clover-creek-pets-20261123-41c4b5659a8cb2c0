import "server-only";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { toError } from "@repo/errors/boundary";
import type { Locale } from "@repo/i18n/types";
import { Effect, Layer, Schema } from "effect";

import { Actions } from "./actions";
import { AppRuntime, CommerceApp } from "./app-runtime";
import { nextCommerceRequest } from "./commerce-request";
import type { NextCommerceRequestOptions } from "./commerce-request";

export { CommerceApp } from "./app-runtime";
export { Actions } from "./actions";
export {
  makeCommerceRequest,
  makeNextCommerceRequest,
  type NextCommerceRequestOptions,
} from "./commerce-request";

const logFailure = (error: unknown) =>
  Schema.is(CommerceAccountUnavailable)(error)
    ? Effect.logError("The customer account is unavailable", error)
    : Effect.void;

export const CommerceActions = Actions.provide(({ locale }) =>
  Layer.unwrap(
    nextCommerceRequest(locale).pipe(
      Effect.tapError(logFailure),
      Effect.map((request) =>
        CommerceApp.requestLayer(request).pipe(Layer.tapError(logFailure))
      )
    )
  )
);

export const NextCommerce = {
  provideContext:
    (locale: Locale, options?: NextCommerceRequestOptions) =>
    <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const request = yield* nextCommerceRequest(locale, options);
        return yield* program.pipe(
          Effect.provide(CommerceApp.contextLayer(request.context))
        );
      }),
  provide:
    (locale: Locale, options?: NextCommerceRequestOptions) =>
    <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const request = yield* nextCommerceRequest(locale, options);
        return yield* program.pipe(
          Effect.provide(CommerceApp.requestLayer(request))
        );
      }).pipe(Effect.tapError(logFailure)),
  provideAddressBook: CommerceApp.provideAddressBook,
  runPromise: async <A, E>(program: Effect.Effect<A, E, ManagedServices>) =>
    await AppRuntime.runPromise(
      program.pipe(
        Effect.mapError((error) =>
          toError(error, "The Commerce request failed.")
        )
      )
    ),
};

type ManagedServices = Effect.Services<
  Parameters<typeof AppRuntime.runPromise>[0]
>;
