import { catalogChangeTags } from "@repo/commerce-core/product/cache-tags";
import type { CatalogChange } from "@repo/commerce-core/product/cache-tags";
import { relatedPreviewOrigin } from "@repo/next-config/keys";
import { Config, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { EventConsumerFailure } from "../webhooks/receiver";
import type { CommerceEventConsumer } from "../webhooks/receiver";
import { catalogSubscription } from "./subscription";

const failure = (
  reason: EventConsumerFailure["reason"],
  operation: string,
  message: string,
  downstreamStatus?: number
) =>
  new EventConsumerFailure({
    consumer: "catalog",
    downstreamStatus,
    message,
    operation,
    reason,
    status: 503,
  });

export const catalogEventConsumer: CommerceEventConsumer = {
  handle: (event) =>
    Effect.gen(function* () {
      const config = yield* Effect.gen(function* () {
        const webBinding = (yield* Config.String("WEB_INTERNAL_URL").pipe(
          Config.withDefault("")
        )).trim();
        const webOrigin =
          webBinding ||
          (yield* Effect.try({
            try: () => relatedPreviewOrigin("RELATED_WEB_PROJECT_ID"),
            catch: () =>
              new Error(
                "No matching Vercel storefront preview for catalog revalidation."
              ),
          }));
        const endpoint =
          webOrigin || (yield* Config.NonEmptyString("REVALIDATION_ENDPOINT"));
        const secret = yield* Config.schema(
          Schema.RedactedFromValue(Schema.NonEmptyString),
          "REVALIDATION_SECRET"
        );
        return {
          endpoint,
          secret,
          useBinding: webBinding !== "",
          useOrigin: !!webOrigin,
        };
      }).pipe(
        Effect.mapError(() =>
          failure(
            "configuration",
            "catalog.revalidation.configure",
            "Configure WEB_INTERNAL_URL or REVALIDATION_ENDPOINT, and set REVALIDATION_SECRET in the API runtime"
          )
        )
      );
      const url = URL.parse(config.endpoint);
      if (
        !url ||
        !(
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            (config.useBinding ||
              url.hostname === "localhost" ||
              url.hostname.endsWith(".localhost") ||
              url.hostname === "127.0.0.1" ||
              url.hostname === "[::1]"))
        ) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        return yield* failure(
          "configuration",
          "catalog.revalidation.configure",
          config.useBinding
            ? "WEB_INTERNAL_URL must be an HTTP(S) service URL without credentials, a query, or a fragment"
            : "REVALIDATION_ENDPOINT must be a full HTTPS web endpoint; HTTP is allowed only on localhost"
        );
      }
      if (config.useOrigin) {
        url.pathname = `${url.pathname.replace(/\/$/u, "")}/api/revalidate`;
      }
      const change: CatalogChange =
        event.resourceTypeId === "product"
          ? { id: event.resourceId, kind: "product" }
          : {
              kind:
                event.resourceTypeId === "category" ? "category" : "catalog",
            };
      const client = yield* HttpClient.HttpClient;
      const request = yield* HttpClientRequest.post(url.href).pipe(
        HttpClientRequest.bearerToken(Redacted.value(config.secret)),
        HttpClientRequest.bodyJson({ tags: catalogChangeTags(change) }),
        Effect.mapError(() =>
          failure(
            "configuration",
            "catalog.revalidation.encode",
            "Could not encode the catalog change"
          )
        )
      );
      const response = yield* client
        .execute(request)
        .pipe(
          Effect.mapError(() =>
            failure(
              "transport",
              "catalog.revalidation.send",
              "Could not reach the web catalog revalidation endpoint"
            )
          )
        );
      if (response.status !== 200) {
        return yield* failure(
          "http",
          "catalog.revalidation.response",
          "The web application rejected catalog revalidation",
          response.status
        );
      }
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(
          failure(
            "timeout",
            "catalog.revalidation.send",
            "Web catalog revalidation timed out after 15 seconds"
          )
        )
      ),
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provide(
            Layer.succeed(FetchHttpClient.RequestInit, {
              cache: "no-store",
              redirect: "error",
            })
          )
        )
      )
    ),
  subscription: catalogSubscription,
};
