import "server-only";
import { Config, Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { FulfillmentHttpApi } from "../api";

/** The Admin app crosses HTTP; no native commerce credentials enter that application. */
export const fulfillmentHttpClient = (accessToken: string, baseUrl?: string) =>
  Effect.gen(function* () {
    const configured = baseUrl ?? (yield* Config.String("FULFILLMENT_API_URL"));
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol)) {
      return yield* Effect.die(
        new Error("FULFILLMENT_API_URL must use HTTP or HTTPS")
      );
    }
    return yield* HttpApiClient.make(FulfillmentHttpApi, {
      baseUrl: configured.replace(/\/$/u, ""),
      transformClient: HttpClient.mapRequest((request) =>
        HttpClientRequest.bearerToken(
          HttpClientRequest.acceptJson(request),
          accessToken
        )
      ),
    });
  });
