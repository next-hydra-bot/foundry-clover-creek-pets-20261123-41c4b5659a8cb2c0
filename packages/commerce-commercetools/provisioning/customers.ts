import type {
  ByProjectKeyRequestBuilder,
  CustomerUpdateAction,
} from "@commercetools/platform-sdk";
import type { CustomerInput } from "@repo/commerce-core/domain/customer";
import { Customer } from "@repo/commerce-core/domain/customer";
import { Effect, Redacted, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import { recordCatalogChange } from "../catalog/journal";

const request = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    catch: () =>
      new DestinationError({
        message:
          "Commercetools customer provisioning failed; check permissions, native key constraints and customer conflicts.",
      }),
    try: operation,
  });
const NativeCustomer = Schema.Struct({
  email: Schema.NonEmptyString,
  firstName: Schema.optionalKey(Schema.String),
  id: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  lastName: Schema.optionalKey(Schema.String),
  version: Schema.Int,
});
const invalidResponse = () =>
  new DestinationError({
    message: "Commercetools returned an invalid provisioned Customer.",
  });

/** Creates externally authenticated profiles without collecting or assigning passwords. */
export const makeCustomerDestination = (
  client: Effect.Effect<ByProjectKeyRequestBuilder, DestinationError>
) => ({
  entity: Customer,
  reference: (customer: Customer) => ({
    id: customer.customerId,
    key: customer.key ?? "",
  }),
  write: Effect.fn("Commercetools.provisionCustomer")(function* (
    input: CustomerInput
  ) {
    const api = yield* client;
    const response = yield* request(
      async () =>
        await api
          .customers()
          .get({
            queryArgs: { limit: 2, where: `key=${JSON.stringify(input.key)}` },
          })
          .execute()
    );
    const candidates = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ results: Schema.Array(NativeCustomer) })
    )(response.body).pipe(Effect.mapError(invalidResponse));
    const [existing] = candidates.results;
    if (
      candidates.results.length > 1 ||
      (existing && existing.key !== input.key)
    ) {
      return yield* new DestinationError({
        message: "Commercetools customer source key is ambiguous.",
      });
    }
    const desired = {
      email: Redacted.value(input.email),
      firstName:
        input.firstName === undefined
          ? undefined
          : Redacted.value(input.firstName),
      lastName:
        input.lastName === undefined
          ? undefined
          : Redacted.value(input.lastName),
    };
    const actions: CustomerUpdateAction[] = [];
    if (existing && existing.email !== desired.email) {
      actions.push({ action: "changeEmail", email: desired.email });
    }
    if (
      existing &&
      desired.firstName !== undefined &&
      existing.firstName !== desired.firstName
    ) {
      actions.push({ action: "setFirstName", firstName: desired.firstName });
    }
    if (
      existing &&
      desired.lastName !== undefined &&
      existing.lastName !== desired.lastName
    ) {
      actions.push({ action: "setLastName", lastName: desired.lastName });
    }
    let customer: typeof NativeCustomer.Type;
    if (!existing) {
      const created = yield* request(
        async () =>
          await api
            .customers()
            .post({
              body: {
                ...desired,
                authenticationMode: "ExternalAuth",
                key: input.key,
              },
            })
            .execute()
      );
      const { customer: createdCustomer } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ customer: NativeCustomer })
      )(created.body).pipe(Effect.mapError(invalidResponse));
      customer = createdCustomer;
      yield* recordCatalogChange("customer.create", customer);
    } else if (actions.length > 0) {
      const updated = yield* request(
        async () =>
          await api
            .customers()
            .withId({ ID: existing.id })
            .post({ body: { actions, version: existing.version } })
            .execute()
      );
      customer = yield* Schema.decodeUnknownEffect(NativeCustomer)(
        updated.body
      ).pipe(Effect.mapError(invalidResponse));
      yield* recordCatalogChange("customer.update", customer);
    } else {
      customer = existing;
    }
    if (
      customer.key !== input.key ||
      (existing && customer.id !== existing.id)
    ) {
      return yield* new DestinationError({
        message:
          "Commercetools customer destination changed the source identity.",
      });
    }
    return yield* Schema.decodeEffect(Schema.toCodecJson(Customer))({
      customerId: customer.id,
      email: customer.email,
      firstName: customer.firstName ?? "",
      key: input.key,
      lastName: customer.lastName ?? "",
    }).pipe(Effect.mapError(invalidResponse));
  }),
});
