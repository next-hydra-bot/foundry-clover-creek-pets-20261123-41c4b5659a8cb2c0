import {
  makeJsonMigration,
  ProvisionedResource,
} from "@repo/cli-core/json-migrations";
import type { CatalogName } from "@repo/commerce-core/catalog";
import type { CompanyCatalogPlan } from "@repo/commerce-core/catalog/company";
import type { ProvisioningStore } from "@repo/commerce-core/provisioning/pipeline";
import { Array as EffectArray, Effect, Order, Schema } from "effect";
import { DestinationError } from "migrate-sdk";
import type { AnySelfContainedMigrationDefinition } from "migrate-sdk";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This registry composition binds the provider destination to its migration items.
import { makeCompanyCatalogDestination } from "./b2b";
import type { CompanyCatalogBindings } from "./b2b";
import type { CatalogSdk } from "./destination";
import { trackedId } from "./migrations";

const Group = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
const Selection = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString),
});
const Assortment = Schema.Struct({
  key: Schema.NonEmptyString,
  productKeys: Schema.Array(Schema.NonEmptyString),
});
const StoreSelection = Schema.Struct({
  key: Schema.NonEmptyString,
  selectionKey: Schema.NonEmptyString,
});
const Unit = Schema.Struct({
  key: Schema.NonEmptyString,
  storeKeys: Schema.Array(Schema.NonEmptyString),
});
const CompanyGroup = Schema.Struct({
  key: Schema.NonEmptyString,
  groupKey: Schema.NonEmptyString,
});
const Price = Schema.Struct({
  centAmount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  currencyCode: Schema.NonEmptyString,
  distributionChannelKey: Schema.NonEmptyString,
  groupKey: Schema.NonEmptyString,
  pricingGroupKey: Schema.NonEmptyString,
  productKey: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
});
const priceKey = (input: typeof Price.Type) =>
  JSON.stringify([
    input.pricingGroupKey,
    input.distributionChannelKey,
    input.currencyCode,
    input.sku,
  ]);

const invalidUpdate = (cause: Schema.SchemaError) =>
  new DestinationError({
    cause,
    message: "Invalid commercetools company catalog update",
  });

export const makeCompanyCatalogMigrations = (options: {
  readonly bindings: CompanyCatalogBindings;
  readonly channels: AnySelfContainedMigrationDefinition;
  readonly client: Effect.Effect<CatalogSdk, DestinationError>;
  readonly group: string;
  readonly readPlans: Effect.Effect<
    readonly CompanyCatalogPlan[],
    DestinationError
  >;
  readonly products: AnySelfContainedMigrationDefinition;
  readonly sellingKey: string;
  readonly sourceCatalog: CatalogName;
  readonly store: ProvisioningStore;
  readonly stores: AnySelfContainedMigrationDefinition;
  readonly units?: ReadonlyMap<string, AnySelfContainedMigrationDefinition>;
}) =>
  Effect.gen(function* () {
    const { group, sellingKey, store } = options;
    const destination = makeCompanyCatalogDestination(
      options.client,
      options.sourceCatalog,
      sellingKey
    );
    const bindings = new Map(
      options.bindings.map((binding) => [binding.assignmentKey, binding])
    );
    const readRows = options.readPlans.pipe(
      Effect.flatMap((plans) =>
        Effect.gen(function* () {
          const groups = new Map<string, typeof Group.Type>();
          const selections = new Map<string, typeof Selection.Type>();
          const assortments = new Map<string, typeof Assortment.Type>();
          const assignments = new Map<string, typeof StoreSelection.Type>();
          const companies = new Map<string, typeof CompanyGroup.Type>();
          const unitStores = new Map<string, Set<string>>();
          const prices = new Map<string, typeof Price.Type>();

          for (const plan of plans) {
            const { assignment, assortment, pricingGroup, priceList } = plan;
            const binding = bindings.get(assignment.key);
            if (!binding) {
              return yield* new DestinationError({
                message: `Missing company binding for ${assignment.key}`,
              });
            }
            const { storeKey, locale } = plan.store;
            const selectionKey = `company-catalog-${sellingKey}-${assortment.key}`;
            const companyKey = assignment.businessUnitKey;
            groups.set(binding.customerGroupKey, {
              key: binding.customerGroupKey,
              name: pricingGroup.key,
            });
            selections.set(selectionKey, {
              key: selectionKey,
              name: {
                ...selections.get(selectionKey)?.name,
                [locale]: selectionKey,
              },
            });
            assortments.set(selectionKey, {
              key: selectionKey,
              productKeys: assortment.productKeys,
            });
            assignments.set(storeKey, { key: storeKey, selectionKey });
            companies.set(companyKey, {
              key: companyKey,
              groupKey: binding.customerGroupKey,
            });
            const stores = unitStores.get(companyKey) ?? new Set();
            stores.add(storeKey);
            unitStores.set(companyKey, stores);
            const priceBySku = new Map(
              priceList.prices.map(({ sku, centAmount }) => [sku, centAmount])
            );
            for (const product of plan.products) {
              for (const { sku } of product.variants) {
                const centAmount = priceBySku.get(sku);
                if (centAmount === undefined) {
                  return yield* new DestinationError({
                    message: `Missing company price for ${sku}`,
                  });
                }
                const item = {
                  centAmount,
                  currencyCode: priceList.currency,
                  distributionChannelKey: binding.distributionChannelKey,
                  groupKey: binding.customerGroupKey,
                  pricingGroupKey: pricingGroup.key,
                  productKey: product.key,
                  sku,
                };
                prices.set(priceKey(item), item);
              }
            }
          }
          return {
            groups,
            selections,
            assortments,
            assignments,
            companies,
            unitStores,
            prices,
          };
        })
      )
    );
    const customerGroups = yield* makeJsonMigration({
      id: "commercetools-company-customer-groups",
      group,
      input: {
        schema: Group,
        read: readRows.pipe(Effect.map(({ groups }) => [...groups.values()])),
        key: ({ key }) => key,
      },
      destination: {
        entity: ProvisionedResource,
        reference: (entity) => entity,
        write: ({ key, name }) =>
          destination
            .ensureCustomerGroup(key, name)
            .pipe(Effect.map(({ id }) => ({ id, key }))),
      },
      revision: "customer-group-v1",
      store,
    });
    const productSelections = yield* makeJsonMigration({
      id: "commercetools-company-product-selections",
      group,
      input: {
        schema: Selection,
        read: readRows.pipe(
          Effect.map(({ selections }) => [...selections.values()])
        ),
        key: ({ key }) => key,
      },
      destination: {
        entity: ProvisionedResource,
        reference: (entity) => entity,
        write: ({ key, name }) =>
          destination.ensureSelection(key, name).pipe(
            Effect.map(({ id }) => ({ id, key })),
            Effect.mapError((cause) =>
              cause._tag === "SchemaError" ? invalidUpdate(cause) : cause
            )
          ),
      },
      revision: "company-product-selection-v1",
      store,
    });
    const selectionProducts = yield* makeJsonMigration({
      id: "commercetools-company-selection-products",
      group,
      dependencies: [productSelections, options.products],
      input: {
        schema: Assortment,
        read: readRows.pipe(
          Effect.map(({ assortments }) => [...assortments.values()])
        ),
        key: ({ key }) => key,
      },
      destination: {
        entity: ProvisionedResource,
        reference: (entity) => entity,
        write: ({ key, productKeys }, references) =>
          Effect.gen(function* () {
            const selection = yield* references.get(productSelections, key);
            const ids = yield* Effect.forEach((productKey: string) =>
              trackedId(options.products, productKey)
            )(productKeys);
            yield* destination.setSelectionProducts(selection.id, ids);
            return selection;
          }).pipe(
            Effect.catchTag("SchemaError", (cause) =>
              Effect.fail(invalidUpdate(cause))
            )
          ),
      },
      revision: "company-selection-products-v1",
      store,
    });
    const storeSelections = yield* makeJsonMigration({
      id: "commercetools-company-store-selections",
      group,
      dependencies: [selectionProducts, options.stores],
      input: {
        schema: StoreSelection,
        read: readRows.pipe(
          Effect.map(({ assignments }) => [...assignments.values()])
        ),
        key: ({ key }) => key,
      },
      destination: {
        entity: ProvisionedResource,
        reference: (entity) => entity,
        write: ({ key, selectionKey }, references) =>
          Effect.gen(function* () {
            const selection = yield* references.get(
              selectionProducts,
              selectionKey
            );
            const target = yield* references.get(options.stores, key);
            yield* destination.assignSelection(key, target.id, selection.id);
            return target;
          }).pipe(
            Effect.catchTag("SchemaError", (cause) =>
              Effect.fail(invalidUpdate(cause))
            )
          ),
      },
      revision: "company-store-selection-v1",
      store,
    });
    const fixedPrices = yield* makeJsonMigration({
      id: "commercetools-company-fixed-prices",
      group,
      dependencies: [options.products, options.channels, customerGroups],
      input: {
        schema: Price,
        read: readRows.pipe(Effect.map(({ prices }) => [...prices.values()])),
        key: priceKey,
      },
      destination: {
        entity: ProvisionedResource,
        reference: (entity) => entity,
        write: (input, references) =>
          Effect.gen(function* () {
            const id = yield* trackedId(options.products, input.productKey);
            const channel = yield* references.get(
              options.channels,
              input.distributionChannelKey
            );
            const customerGroup = yield* references.get(
              customerGroups,
              input.groupKey
            );
            yield* destination.setPrice(
              input,
              id,
              channel.id,
              customerGroup.id
            );
            return { id, key: priceKey(input) };
          }).pipe(
            Effect.catchTag("SchemaError", (cause) =>
              Effect.fail(invalidUpdate(cause))
            )
          ),
      },
      revision: "company-fixed-price-v1",
      store,
    });
    const standaloneUnits =
      options.units === undefined
        ? yield* makeJsonMigration({
            id: "commercetools-catalog-business-units",
            group,
            dependencies: [options.stores],
            input: {
              schema: Unit,
              read: readRows.pipe(
                Effect.map(({ unitStores }) =>
                  [...unitStores].map(([key, stores]) => ({
                    key,
                    storeKeys: EffectArray.sort(stores, Order.String),
                  }))
                )
              ),
              key: ({ key }) => key,
            },
            destination: {
              entity: ProvisionedResource,
              reference: (entity) => entity,
              write: ({ key, storeKeys }, references) =>
                Effect.gen(function* () {
                  const stores = yield* Effect.forEach((storeKey: string) =>
                    references.get(options.stores, storeKey)
                  )(storeKeys);
                  const unit = yield* destination.ensureBusinessUnit(
                    key,
                    stores
                  );
                  return { id: unit.id, key };
                }).pipe(
                  Effect.catchTag("SchemaError", (cause) =>
                    Effect.fail(invalidUpdate(cause))
                  )
                ),
            },
            revision: "catalog-business-unit-v1",
            store,
          })
        : undefined;
    const companyAssignments = yield* makeJsonMigration({
      id: "commercetools-company-group-assignments",
      group,
      dependencies: [
        customerGroups,
        ...(standaloneUnits
          ? [standaloneUnits]
          : new Set(options.units?.values())),
      ],
      input: {
        schema: CompanyGroup,
        read: readRows.pipe(
          Effect.map(({ companies }) => [...companies.values()])
        ),
        key: ({ key }) => key,
      },
      destination: {
        entity: ProvisionedResource,
        reference: (entity) => entity,
        write: ({ key, groupKey }, references) =>
          Effect.gen(function* () {
            const definition = standaloneUnits ?? options.units?.get(key);
            if (!definition) {
              return yield* new DestinationError({
                message: `Missing Business Unit migration for ${key}`,
              });
            }
            const unit = yield* references.get(definition, key);
            const customerGroup = yield* references.get(
              customerGroups,
              groupKey
            );
            yield* destination.assignCustomerGroup(unit.id, customerGroup.id);
            return unit;
          }),
      },
      revision: "company-group-assignment-v1",
      store,
    });
    return [
      customerGroups,
      productSelections,
      selectionProducts,
      storeSelections,
      fixedPrices,
      ...(standaloneUnits ? [standaloneUnits] : []),
      companyAssignments,
    ];
  });
