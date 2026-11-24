import { describe, expect, it } from "@effect/vitest";
import { catalogChangeTags } from "@repo/commerce-core/product/cache-tags";
import { ConfigProvider, Effect, Fiber, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { catalogEventConsumer } from "./events";

const event = {
  data: {},
  notificationType: "ResourceUpdated",
  projectKey: "project",
  resourceId: "product-1",
  resourceTypeId: "product",
  timestamp: "2026-11-03T00:00:00Z",
};
const configuration = {
  REVALIDATION_ENDPOINT: "https://web.example.com/api/revalidate",
  REVALIDATION_SECRET: "cache-secret",
};
const handoff = (
  fetchApi: typeof fetch,
  values: Record<string, string> = configuration
) =>
  catalogEventConsumer
    .handle(event)
    .pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(values)
      ),
      Effect.provideService(FetchHttpClient.Fetch, fetchApi)
    );

describe("catalog event handoff", () => {
  it.effect(
    "posts catalog cache tags to the shared web revalidation endpoint",
    () =>
      Effect.gen(function* () {
        const fetchApi = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 200 }));
        yield* handoff(fetchApi);
        const [input, init] = fetchApi.mock.calls[0] ?? [];
        if (input === undefined) {
          throw new Error("Expected an outgoing revalidation request");
        }
        const request = new Request(input, init);
        expect(request.url).toBe(configuration.REVALIDATION_ENDPOINT);
        expect(request.headers.get("authorization")).toBe(
          "Bearer cache-secret"
        );
        const text = yield* Effect.promise(async () => await request.text());
        const body = Schema.decodeSync(Schema.fromJsonString(Schema.Json))(
          text
        );
        expect(body).toEqual({
          tags: catalogChangeTags({ id: "product-1", kind: "product" }),
        });
      })
  );

  it.effect(
    "uses the web binding without a configured revalidation endpoint",
    () =>
      Effect.gen(function* () {
        const fetchApi = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 200 }));
        yield* handoff(fetchApi, {
          WEB_INTERNAL_URL: "http://web.internal/",
          REVALIDATION_SECRET: configuration.REVALIDATION_SECRET,
        });
        expect(fetchApi).toHaveBeenCalledOnce();
        expect(String(fetchApi.mock.calls[0]?.[0])).toBe(
          "http://web.internal/api/revalidate"
        );
      })
  );

  for (const status of [401, 503]) {
    it.effect(
      `preserves downstream HTTP ${status} as a retryable delivery diagnostic`,
      () =>
        Effect.gen(function* () {
          const fetchApi = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(null, { status }));
          const error = yield* handoff(fetchApi).pipe(Effect.flip);
          expect(error).toMatchObject({
            consumer: "catalog",
            downstreamStatus: status,
            operation: "catalog.revalidation.response",
            reason: "http",
            status: 503,
          });
          expect(JSON.stringify(error)).not.toContain("cache-secret");
        })
    );
  }

  it.effect("identifies missing configuration without making a request", () =>
    Effect.gen(function* () {
      const fetchApi = vi.fn<typeof fetch>();
      const error = yield* handoff(fetchApi, {}).pipe(Effect.flip);
      expect(error).toMatchObject({
        operation: "catalog.revalidation.configure",
        reason: "configuration",
        status: 503,
      });
      expect(fetchApi).not.toHaveBeenCalled();
    })
  );

  it.effect(
    "identifies transport failures without retaining private request headers",
    () =>
      Effect.gen(function* () {
        const fetchApi = vi
          .fn<typeof fetch>()
          .mockRejectedValue(
            new Error("request with Bearer cache-secret failed")
          );
        const error = yield* handoff(fetchApi, {
          ...configuration,
          WEB_INTERNAL_URL: "http://web.internal/",
        }).pipe(Effect.flip);
        expect(fetchApi).toHaveBeenCalledOnce();
        expect(String(fetchApi.mock.calls[0]?.[0])).toBe(
          "http://web.internal/api/revalidate"
        );
        expect(error).toMatchObject({
          operation: "catalog.revalidation.send",
          reason: "transport",
          status: 503,
        });
        expect(JSON.stringify(error)).not.toContain("cache-secret");
      })
  );

  it.effect("identifies timeouts separately from downstream HTTP errors", () =>
    Effect.gen(function* () {
      const fetchApi = vi.fn<typeof fetch>().mockImplementation(
        async (_input, init) =>
          await Effect.runPromise(Effect.never, {
            signal: init?.signal ?? undefined,
          })
      );
      const fiber = yield* handoff(fetchApi).pipe(Effect.forkChild);
      yield* TestClock.adjust("15 seconds");
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      expect(error).toMatchObject({
        operation: "catalog.revalidation.send",
        reason: "timeout",
        status: 503,
      });
    })
  );
});
