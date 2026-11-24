import type {
  CommerceBusinessUnitId,
  CommerceBusinessUnitMembership,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  B2CPurchasingPrincipal,
  CommerceRequestContextNotFound,
  CustomerCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceRequestProvisionError } from "@repo/commerce-core/runtime/make-commerce-base-app";
import { CommerceAccounts } from "@repo/commerce-core/services/commerce-accounts";
import type { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Context, Effect, Layer, Option } from "effect";

import { commercetoolsRestClientLayer } from "../client/layers";
import { CommercetoolsRestClient } from "../client/rest-client";
import {
  businessUnitMembershipForCustomerWith,
  commerceAccountsLayerFrom,
} from "../commerce-accounts/commerce-accounts";

/** Resolves verified customer or company authority without applying shopping Store eligibility. */
export class CommercetoolsAccountContext extends Context.Service<
  CommercetoolsAccountContext,
  {
    readonly resolve: (
      request: CommerceContextRequest
    ) => Effect.Effect<
      CommerceContext["Service"],
      CommerceRequestProvisionError
    >;
  }
>()("@repo/commerce-commercetools/http/AccountContext") {}

type FindMembership = (
  customerId: CommerceCustomerId,
  businessUnitId: CommerceBusinessUnitId
) => Effect.Effect<
  Option.Option<CommerceBusinessUnitMembership>,
  CommerceAccountUnavailable
>;

export const accountContextLayerWith = (
  accounts: Pick<
    CommerceAccounts["Service"],
    "getCustomerIdByAuthUserId" | "getCustomerProfile"
  >,
  findMembership: FindMembership
) =>
  Layer.succeed(CommercetoolsAccountContext, {
    resolve: Effect.fn("CommercetoolsAccountContext.resolve")(function* (
      request: CommerceContextRequest
    ) {
      if (request._tag === "AnonymousCommerceContextRequest") {
        return yield* new CommerceRequestContextNotFound({
          message: "Sign in to access your account.",
          reason: "noPrincipal",
        });
      }
      const customerId = yield* accounts
        .getCustomerIdByAuthUserId(request.authUserId)
        .pipe(
          Effect.catchTag(
            "CommerceCustomerIdNotFound",
            () =>
              new CommerceRequestContextNotFound({
                message: "The signed-in identity has no linked Customer.",
                reason: "noCustomerMapping",
              })
          )
        );
      const principal = yield* Effect.gen(function* () {
        if (request._tag === "B2CPurchasingContextRequest") {
          return new B2CPurchasingPrincipal({
            authUserId: request.authUserId,
            customerId,
          });
        }
        if (request.businessUnitId === undefined) {
          return yield* new CommerceRequestContextNotFound({
            message: "Select a company to access its account.",
            reason: "noBuyingContext",
          });
        }
        const membership = yield* findMembership(
          customerId,
          request.businessUnitId
        );
        if (Option.isNone(membership)) {
          return yield* new CommerceRequestContextNotFound({
            message: "The Customer does not belong to the selected company.",
            reason: "noBuyingContext",
          });
        }
        return new CustomerCommercePrincipal({
          authUserId: request.authUserId,
          businessUnitId: membership.value.businessUnitId,
          businessUnitKey: membership.value.businessUnitKey,
          customerId,
          roles: membership.value.roles,
        });
      });
      return CommerceContext.of({
        customerPrincipal: () => Effect.succeed(principal),
        customerProfile: () => accounts.getCustomerProfile(customerId),
        principal,
        store: request.store,
      });
    }),
  });

export const accountContextLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { apiRoot } = yield* CommercetoolsRestClient;
    const accounts = yield* CommerceAccounts;
    return accountContextLayerWith(
      accounts,
      businessUnitMembershipForCustomerWith(apiRoot)
    );
  })
).pipe(
  Layer.provide(
    Layer.unwrap(
      CommercetoolsRestClient.pipe(
        Effect.map(({ apiRoot }) => commerceAccountsLayerFrom(apiRoot))
      )
    )
  ),
  Layer.provide(commercetoolsRestClientLayer)
);
