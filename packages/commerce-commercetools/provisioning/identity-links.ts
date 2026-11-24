import type { ByProjectKeyRequestBuilder } from "@commercetools/platform-sdk";
import type { CustomerIdentityLink } from "@repo/commerce-core/domain/customer-identity-link";
import { Effect } from "effect";
import { DestinationError } from "migrate-sdk";

import { recordCatalogChange } from "../catalog/journal";

const fail = () =>
  new DestinationError({
    message:
      "Commercetools Customer identity conflicts with the source relation.",
  });
const request = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: fail, try: run });
/** An explicit administrator-owned source relation, resolved by migrated keys, never email adoption. */
export const makeIdentityLinkDestination = (
  client: Effect.Effect<ByProjectKeyRequestBuilder, DestinationError>
) =>
  Effect.fn("Commercetools.provisionIdentityLink")(function* (
    input: CustomerIdentityLink
  ) {
    const api = yield* client;
    const customer = (yield* request(
      async () =>
        await api.customers().withId({ ID: input.customerId }).get().execute()
    )).body;
    if (customer.id !== input.customerId) {
      return yield* fail();
    }
    const existing = (yield* request(
      async () =>
        await api
          .customers()
          .get({
            queryArgs: {
              limit: 2,
              where: `externalId=${JSON.stringify(input.authUserId)}`,
            },
          })
          .execute()
    )).body.results;
    if (
      (customer.externalId && customer.externalId !== input.authUserId) ||
      existing.some(({ id }) => id !== customer.id) ||
      existing.length > 1 ||
      customer.authenticationMode !== "ExternalAuth"
    ) {
      return yield* fail();
    }
    if (!customer.externalId) {
      const saved = (yield* request(
        async () =>
          await api
            .customers()
            .withId({ ID: customer.id })
            .post({
              body: {
                actions: [
                  { action: "setExternalId", externalId: input.authUserId },
                ],
                version: customer.version,
              },
            })
            .execute()
      )).body;
      yield* recordCatalogChange("customer.link-identity", saved);
      if (saved.externalId !== input.authUserId) {
        return yield* fail();
      }
    }
    return input;
  });
