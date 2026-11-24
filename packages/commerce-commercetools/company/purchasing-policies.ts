import type { ByProjectKeyRequestBuilder } from "@commercetools/platform-sdk";
import type { CompanyPurchasingPolicy } from "@repo/commerce-core/domain/company-purchasing-policy";
import { sameCompanyPurchasingPolicy } from "@repo/commerce-core/domain/company-purchasing-policy";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { CompanyPurchasingPolicies } from "@repo/commerce-core/services/company-purchasing-policies";
import { resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Schema } from "effect";

import { commercetoolsRestClientLayer } from "../client/layers";
import { CommercetoolsRestClient } from "../client/rest-client";
import { assignBusinessUnitCustomerGroup } from "./purchasing";
import { CommercetoolsPurchasingPolicyBindings } from "./purchasing-policy-bindings";

export { CommercetoolsPurchasingPolicyBindings } from "./purchasing-policy-bindings";

const fail = (message: string) => new CommerceAccountUnavailable({ message });
const publicPolicy = ({
  key,
  label,
  storeKey,
  locale,
  currency,
  pricingGroupKey,
}: CompanyPurchasingPolicy): CompanyPurchasingPolicy => ({
  currency,
  key,
  label,
  locale,
  pricingGroupKey,
  storeKey,
});

export const companyPurchasingPoliciesLayerFrom = (
  api: ByProjectKeyRequestBuilder,
  bindings: CommercetoolsPurchasingPolicyBindings
) =>
  Layer.succeed(
    CompanyPurchasingPolicies,
    CompanyPurchasingPolicies.of({
      assign: ({ account, policy: approved }) =>
        Effect.gen(function* () {
          const { storeKey, key: policyKey } = approved;
          const policy = bindings.find(
            (candidate) =>
              candidate.key === policyKey && candidate.storeKey === storeKey
          );
          const store = policy
            ? resolveStore({
                locale: policy.locale,
                selectedStoreKey: storeKey,
              })
            : undefined;
          if (
            !policy ||
            !sameCompanyPurchasingPolicy(policy, approved) ||
            store?.storeKey !== storeKey ||
            store.currency !== policy.currency
          ) {
            return yield* fail(
              "The company purchasing policy is not configured for this Store and currency or its approved terms have changed."
            );
          }
          const result = yield* Effect.tryPromise({
            catch: () =>
              fail("Company purchasing resources could not be read."),
            try: async () =>
              await Promise.all([
                api.stores().withKey({ key: storeKey }).get().execute(),
                api
                  .customerGroups()
                  .withId({ ID: policy.customerGroupId })
                  .get()
                  .execute(),
                api
                  .businessUnits()
                  .withId({ ID: account.businessUnitId })
                  .get()
                  .execute(),
              ]),
          });
          const nativeStore = result[0].body;
          const nativeGroup = result[1].body;
          const nativeUnit = result[2].body;
          if (
            nativeStore.key !== storeKey ||
            nativeGroup.id !== policy.customerGroupId ||
            nativeUnit.id !== account.businessUnitId ||
            nativeStore.distributionChannels.length !== 1
          ) {
            return yield* fail(
              "The native Store does not match the approved pricing policy."
            );
          }
          if (
            !(
              nativeUnit.storeMode === "Explicit" &&
              nativeUnit.stores?.some(({ key }) => key === storeKey)
            )
          ) {
            const saved = yield* Effect.tryPromise({
              catch: () =>
                fail(
                  "Company purchasing assignment could not be confirmed; retry onboarding to reconcile it."
                ),
              try: async () =>
                await api
                  .businessUnits()
                  .withId({ ID: nativeUnit.id })
                  .post({
                    body: {
                      actions: [
                        {
                          action: "setStoreMode",
                          storeMode: "Explicit",
                          stores: [
                            ...(nativeUnit.stores ?? []).filter(
                              ({ key }) => key !== storeKey
                            ),
                            { key: storeKey, typeId: "store" },
                          ],
                        },
                      ],
                      version: nativeUnit.version,
                    },
                  })
                  .execute(),
            });
            if (
              saved.body.id !== account.businessUnitId ||
              saved.body.storeMode !== "Explicit" ||
              !saved.body.stores?.some(({ key }) => key === storeKey)
            ) {
              return yield* fail(
                "Company purchasing assignment could not be confirmed; retry onboarding to reconcile it."
              );
            }
          }
          yield* assignBusinessUnitCustomerGroup(
            api,
            account.businessUnitId,
            policy.customerGroupId
          ).pipe(
            Effect.mapError(() =>
              fail(
                "Company purchasing assignment could not be confirmed; retry onboarding to reconcile it."
              )
            )
          );
        }),
      list: (storeKey) =>
        Effect.succeed(
          bindings
            .filter((policy) => policy.storeKey === storeKey)
            .map(publicPolicy)
        ),
    })
  );
export const companyPurchasingPoliciesLayer = Layer.suspend(() => {
  const bindings = Schema.decodeSync(
    Schema.fromJsonString(CommercetoolsPurchasingPolicyBindings)
  )(process.env.COMMERCETOOLS_COMPANY_PURCHASING_POLICIES ?? "[]");
  if (new Set(bindings.map(({ key }) => key)).size !== bindings.length) {
    throw new Error("Company purchasing policy keys must be unique.");
  }
  for (const policy of bindings) {
    const store = resolveStore({
      locale: policy.locale,
      selectedStoreKey: policy.storeKey,
    });
    if (
      store.storeKey !== policy.storeKey ||
      store.currency !== policy.currency
    ) {
      throw new Error(
        "Company purchasing policies must match explicit Core Store, locale and currency mappings."
      );
    }
  }
  return Layer.unwrap(
    CommercetoolsRestClient.pipe(
      Effect.map(({ apiRoot }) =>
        companyPurchasingPoliciesLayerFrom(apiRoot, bindings)
      )
    )
  ).pipe(Layer.provide(commercetoolsRestClientLayer));
});
