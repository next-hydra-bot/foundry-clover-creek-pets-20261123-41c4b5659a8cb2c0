import { AccessTokenVerifier } from "@repo/auth-contract/access-token";
import {
  organizationPermissionsLayer,
  Permissions,
} from "@repo/auth-contract/permissions";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

/** Request metadata is untrusted input for the selected session verifier. */
export interface FulfillmentHttpCredentials {
  readonly bearer: Redacted.Redacted;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly url: string;
}
export class FulfillmentAuthenticationFailure extends Schema.TaggedError<FulfillmentAuthenticationFailure>()(
  "FulfillmentAuthenticationFailure",
  {
    reason: Schema.Literals(["unauthorized", "unavailable"]),
  }
) {}
/** Admin and a future Merchant Center session verifier supply the same permission seam. */
export class FulfillmentAuthentication extends Context.Service<
  FulfillmentAuthentication,
  {
    readonly authenticate: (
      credentials: FulfillmentHttpCredentials
    ) => Effect.Effect<
      Permissions["Service"],
      FulfillmentAuthenticationFailure
    >;
  }
>()("@repo/commerce-core/FulfillmentAuthentication") {}

/** Compose with an ADMIN-configured verifier, never the storefront identity pool. */
export const fulfillmentAdminAuthenticationLayer = Layer.effect(
  FulfillmentAuthentication,
  Effect.gen(function* () {
    const verifier = yield* AccessTokenVerifier;
    return FulfillmentAuthentication.of({
      authenticate: ({ bearer }) =>
        verifier.verify(Redacted.value(bearer)).pipe(
          Effect.flatMap((verified) =>
            Permissions.pipe(
              Effect.provide(organizationPermissionsLayer(verified))
            )
          ),
          Effect.catchTags({
            AccessTokenInvalid: () =>
              Effect.fail(
                new FulfillmentAuthenticationFailure({ reason: "unauthorized" })
              ),
            AccessTokenVerificationFailure: () =>
              Effect.fail(
                new FulfillmentAuthenticationFailure({ reason: "unavailable" })
              ),
          })
        ),
    });
  })
);
