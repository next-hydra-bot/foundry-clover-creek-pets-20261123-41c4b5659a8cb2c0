import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/ts-client";
import { expect, layer } from "@effect/vitest";
import { Customer, CustomerInput } from "@repo/commerce-core/domain/customer";
import { Effect, Schema } from "effect";

import { testTracking } from "../catalog/tracking.test-fixture";
import { makeCustomerDestination } from "./customers";

layer(testTracking)("Domain provisioning", (it) => {
  it.effect(
    "uses native keys, ExternalAuth and optimistic updates for the common Customer input",
    () =>
      Effect.gen(function* () {
        const input = Schema.decodeSync(Schema.toCodecJson(CustomerInput))({
          email: "shopper@example.com",
          firstName: "Alex",
          key: "shopper",
          lastName: "Morgan",
        });
        const writes: Schema.Json[] = [];
        let exists = false;
        let firstName = "Alex";
        const customer = () => ({
          email: "shopper@example.com",
          externalId: "existing-auth-user",
          firstName,
          id: "ct-customer-42",
          key: input.key,
          lastName: "Morgan",
          version: 7,
        });
        const fetcher: typeof fetch = async (request, init) => {
          const nativeRequest = new Request(request, init);
          if (nativeRequest.method === "GET") {
            return Response.json({ results: exists ? [customer()] : [] });
          }
          writes.push(
            Schema.decodeSync(Schema.fromJsonString(Schema.Json))(
              await nativeRequest.text()
            )
          );
          const wasExisting = exists;
          exists = true;
          firstName = "Alex";
          return Response.json(
            wasExisting ? customer() : { customer: customer() }
          );
        };
        const sdk = new ClientBuilder()
          .withHttpMiddleware({
            enableRetry: false,
            host: "https://api.example.test",
            httpClient: fetcher,
          })
          .build();
        const api = createApiBuilderFromCtpClient(sdk).withProjectKey({
          projectKey: "fixtures",
        });
        const destination = makeCustomerDestination(Effect.succeed(api));
        const first = yield* destination.write(input);
        yield* Schema.decodeUnknownEffect(Schema.toType(Customer))(first);
        expect(first).toMatchObject({
          customerId: "ct-customer-42",
          key: input.key,
        });
        expect(writes[0]).toMatchObject({
          authenticationMode: "ExternalAuth",
          key: input.key,
        });
        expect(writes[0]).not.toHaveProperty("password");
        yield* destination.write(input);
        expect(writes).toHaveLength(1);
        firstName = "Old name";
        yield* destination.write(input);
        expect(writes[1]).toEqual({
          actions: [{ action: "setFirstName", firstName: "Alex" }],
          version: 7,
        });
      })
  );
});
