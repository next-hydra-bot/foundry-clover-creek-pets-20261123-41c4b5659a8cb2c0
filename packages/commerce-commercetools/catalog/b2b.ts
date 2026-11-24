import { createHash } from "node:crypto";

import type { ByProjectKeyRequestBuilder } from "@commercetools/platform-sdk";
import { nonEmptyUpdateActions } from "@migrate-sdk/commercetools/destination";
import type {
  ProductPriceDraftInput,
  ProductSelectionUpdateAction,
} from "@migrate-sdk/commercetools/destination";
import type { CompanyCatalogPlan } from "@repo/commerce-core/catalog/company";
import { Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import { assignBusinessUnitCustomerGroup } from "../company/purchasing";
import type { CatalogSdk } from "./destination";
import { recordCatalogChange } from "./journal";
import { variantKey } from "./mapping";
import { findProjectStore } from "./project-setup";

export const CompanyCatalogBindings = Schema.Array(
  Schema.Struct({
    assignmentKey: Schema.NonEmptyString,
    customerGroupKey: Schema.NonEmptyString,
    distributionChannelKey: Schema.NonEmptyString,
    supplyChannelKey: Schema.NonEmptyString,
  })
);
export type CompanyCatalogBindings = typeof CompanyCatalogBindings.Type;
export const validateCompanyCatalogBindings = (
  bindings: CompanyCatalogBindings,
  plans: readonly CompanyCatalogPlan[]
) => {
  if (
    bindings.length !== plans.length ||
    new Set(bindings.map(({ assignmentKey }) => assignmentKey)).size !==
      bindings.length ||
    plans.some(
      ({ assignment }) =>
        !bindings.some(({ assignmentKey }) => assignmentKey === assignment.key)
    )
  ) {
    throw new Error(
      "The company bindings file must declare exactly one native binding for every company catalog assignment"
    );
  }
  const groupsByKey = new Map<string, string>();
  const groupsByBusinessUnit = new Map<string, string>();
  const distributionByStore = new Map<string, string>();
  const keysByGroup = new Map<string, string>();
  const supplyByStore = new Map<string, string>();
  for (const plan of plans) {
    const binding = bindings.find(
      ({ assignmentKey }) => assignmentKey === plan.assignment.key
    );
    if (!binding) {
      throw new Error("Missing company catalog binding");
    }
    const group = plan.pricingGroup.key;
    if (
      (groupsByBusinessUnit.has(plan.assignment.businessUnitKey) &&
        groupsByBusinessUnit.get(plan.assignment.businessUnitKey) !==
          binding.customerGroupKey) ||
      (groupsByKey.has(group) &&
        groupsByKey.get(group) !== binding.customerGroupKey) ||
      (keysByGroup.has(binding.customerGroupKey) &&
        keysByGroup.get(binding.customerGroupKey) !== group) ||
      (distributionByStore.has(plan.store.storeKey) &&
        distributionByStore.get(plan.store.storeKey) !==
          binding.distributionChannelKey) ||
      (supplyByStore.has(plan.store.storeKey) &&
        supplyByStore.get(plan.store.storeKey) !== binding.supplyChannelKey)
    ) {
      throw new Error(
        "Company pricing groups require one consistent Customer Group per Business Unit and explicit group keys; assignments in one Store must share distribution and supply channels"
      );
    }
    groupsByBusinessUnit.set(
      plan.assignment.businessUnitKey,
      binding.customerGroupKey
    );
    groupsByKey.set(group, binding.customerGroupKey);
    keysByGroup.set(binding.customerGroupKey, group);
    distributionByStore.set(
      plan.store.storeKey,
      binding.distributionChannelKey
    );
    supplyByStore.set(plan.store.storeKey, binding.supplyChannelKey);
  }
};

const fail = (message: string) => new DestinationError({ message });
const request = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    catch: () =>
      fail(
        "Commercetools company catalog request failed; reconcile current resources before retrying"
      ),
    try: operation,
  });
const whereKey = (key: string) => `key=${JSON.stringify(key)}`;
const resolveCustomerGroup = (
  api: ByProjectKeyRequestBuilder,
  key: string,
  groupName: string
) =>
  Effect.gen(function* () {
    const response = yield* request(
      async () =>
        await api
          .customerGroups()
          .get({ queryArgs: { limit: 2, where: whereKey(key) } })
          .execute()
    );
    if (response.body.results.length > 1) {
      return yield* fail("Ambiguous native Customer Group key");
    }
    const [existing] = response.body.results;
    if (existing) {
      return existing;
    }
    const { body } = yield* request(
      async () =>
        await api.customerGroups().post({ body: { groupName, key } }).execute()
    );
    yield* recordCatalogChange("customer-group.create", body);
    return body;
  });

export const makeCompanyCatalogDestination = (
  client: Effect.Effect<CatalogSdk, DestinationError>,
  sourceCatalog: string,
  sellingKey: string
) => ({
  ensureCustomerGroup: (key: string, name: string) =>
    client.pipe(
      Effect.flatMap(({ apiRoot }) => resolveCustomerGroup(apiRoot, key, name))
    ),

  ensureSelection: (key: string, name: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const { results } = (yield* request(
        async () =>
          await apiRoot
            .productSelections()
            .get({ queryArgs: { limit: 2, where: whereKey(key) } })
            .execute()
      )).body;
      const [existing] = results;
      if (results.length > 1 || (existing && existing.mode !== "Individual")) {
        return yield* fail(
          `Selection ${key} must identify one Individual Product Selection`
        );
      }
      return (
        existing ??
        (yield* write.productSelections.create({
          key,
          mode: "Individual",
          name,
        }))
      );
    }),

  setPrice: (
    input: {
      readonly productKey: string;
      readonly sku: string;
      readonly pricingGroupKey: string;
      readonly distributionChannelKey: string;
      readonly currencyCode: string;
      readonly centAmount: number;
    },
    productId: string,
    distributionId: string,
    groupId: string
  ) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const product = (yield* request(
        async () =>
          await apiRoot.products().withId({ ID: productId }).get().execute()
      )).body;
      const { current, staged } = product.masterData;
      const variant = [current.masterVariant, ...current.variants].find(
        ({ sku }) => sku === input.sku
      );
      if (
        product.key !== input.productKey ||
        variant?.key !== variantKey(sourceCatalog, input.sku)
      ) {
        return yield* fail(`Unmapped or foreign variant ${input.sku}`);
      }
      const stagedVariant = [staged.masterVariant, ...staged.variants].find(
        ({ id }) => id === variant.id
      );
      const key = `company-pricing-${createHash("sha256")
        .update(
          JSON.stringify([
            sellingKey,
            input.pricingGroupKey,
            input.distributionChannelKey,
            input.currencyCode,
            input.sku,
          ])
        )
        .digest("hex")}`;
      const prices = [
        ...(variant.prices ?? []),
        ...(stagedVariant?.prices ?? []),
      ];
      if (
        prices.some(
          (price) =>
            price.channel?.id === distributionId &&
            price.customerGroup?.id === groupId &&
            price.value.currencyCode === input.currencyCode &&
            price.key !== key
        )
      ) {
        return yield* fail(
          `A separately managed price already exists for ${input.sku} in ${input.distributionChannelKey}`
        );
      }
      const price: ProductPriceDraftInput = {
        channel: { id: distributionId, typeId: "channel" },
        customerGroup: { id: groupId, typeId: "customer-group" },
        key,
        value: {
          centAmount: input.centAmount,
          currencyCode: input.currencyCode,
        },
      };
      const owned = prices.find((existing) => existing.key === key);
      const matchesPrice = (existing: (typeof prices)[number]) =>
        existing.key === key &&
        existing.value.centAmount === input.centAmount &&
        existing.value.currencyCode === input.currencyCode &&
        existing.channel?.id === distributionId &&
        existing.customerGroup?.id === groupId;
      if (
        !variant.prices?.some(matchesPrice) ||
        !stagedVariant?.prices?.some(matchesPrice)
      ) {
        yield* write.products.update({
          actions: [
            owned
              ? {
                  action: "changePrice",
                  priceId: owned.id,
                  price,
                  staged: false,
                }
              : {
                  action: "addPrice",
                  variantId: variant.id,
                  price,
                  staged: false,
                },
          ],
          selector: { kind: "id", id: productId },
          version: product.version,
        });
      }
    }),

  setSelectionProducts: (selectionId: string, productIds: readonly string[]) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const resource = apiRoot.productSelections().withId({ ID: selectionId });
      const selection = (yield* request(
        async () => await resource.get().execute()
      )).body;
      const existing = (yield* request(
        async () =>
          await resource
            .products()
            .get({ queryArgs: { limit: 500, withTotal: true } })
            .execute()
      )).body;
      if (
        existing.total === undefined ||
        existing.total > existing.results.length
      ) {
        return yield* fail(
          "Company assortment exceeds the supported 500-product reconciliation read"
        );
      }
      const actions: ProductSelectionUpdateAction[] = [
        ...existing.results
          .filter(({ product }) => !productIds.includes(product.id))
          .map(
            ({ product }): ProductSelectionUpdateAction => ({
              action: "removeProduct",
              product,
            })
          ),
        ...productIds
          .filter(
            (id) => !existing.results.some(({ product }) => product.id === id)
          )
          .map(
            (id): ProductSelectionUpdateAction => ({
              action: "addProduct",
              product: { id, typeId: "product" },
            })
          ),
      ];
      if (actions.length > 0) {
        yield* write.productSelections.update({
          actions: nonEmptyUpdateActions(actions, selectionId),
          selector: { kind: "id", id: selectionId },
          version: selection.version,
        });
      }
    }),

  assignSelection: (storeKey: string, storeId: string, selectionId: string) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const store = yield* findProjectStore(apiRoot, storeKey);
      if (store?.id !== storeId) {
        return yield* fail(
          `Tracked Store ${storeKey} is missing or has changed identity`
        );
      }
      const assigned = store.productSelections.find(
        ({ productSelection }) => productSelection.id === selectionId
      );
      if (!assigned?.active) {
        yield* write.stores.update({
          actions: [
            {
              action: assigned
                ? "changeProductSelectionActive"
                : "addProductSelection",
              active: true,
              productSelection: {
                id: selectionId,
                typeId: "product-selection",
              },
            },
          ],
          selector: { kind: "id", id: storeId },
          version: store.version,
        });
      }
    }),

  ensureBusinessUnit: (
    key: string,
    stores: readonly { readonly id: string; readonly key: string }[]
  ) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const { results } = (yield* request(
        async () =>
          await apiRoot
            .businessUnits()
            .get({ queryArgs: { limit: 2, where: whereKey(key) } })
            .execute()
      )).body;
      const [unit] = results;
      if (results.length > 1 || (unit && unit.storeMode !== "Explicit")) {
        return yield* fail(
          `Company ${key} must identify one Business Unit with explicit Stores`
        );
      }
      if (!unit) {
        return yield* write.businessUnits.create({
          key,
          name: key,
          status: "Active",
          stores: stores.map(({ id }) => ({ id, typeId: "store" })),
          unitType: "Company",
        });
      }
      const actions = stores
        .filter(
          (store) =>
            !(unit.stores ?? []).some(
              ({ key: existingKey }) => existingKey === store.key
            )
        )
        .map(({ id }) => ({
          action: "addStore" as const,
          store: { id, typeId: "store" as const },
        }));
      if (actions.length > 0) {
        return yield* write.businessUnits.update({
          actions: nonEmptyUpdateActions(actions, key),
          selector: { kind: "id", id: unit.id },
          version: unit.version,
        });
      }
      return unit;
    }),

  assignCustomerGroup: (unitId: string, groupId: string) =>
    Effect.gen(function* () {
      const { apiRoot } = yield* client;
      const updated = yield* assignBusinessUnitCustomerGroup(
        apiRoot,
        unitId,
        groupId
      ).pipe(
        Effect.mapError(() =>
          fail(
            "Company purchasing assignment could not be confirmed; retry the catalog import to reconcile it."
          )
        )
      );
      if (updated) {
        yield* recordCatalogChange(
          "business-unit.assign-customer-group",
          updated
        );
      }
    }),
});
