import { documentRows } from "@repo/cli-core/json-migrations";
import type { DocumentRow } from "@repo/cli-core/json-migrations";
import {
  CatalogCategory,
  CatalogProductContent,
  CatalogProductReferences,
  catalogReferenceKeys,
  catalogProductReferences,
  catalogProductContent,
} from "@repo/commerce-core/catalog";
import type { Catalog, CatalogName } from "@repo/commerce-core/catalog";
import {
  catalogReaders,
  catalogByName,
} from "@repo/commerce-core/catalog/files";
import type { CatalogReaders } from "@repo/commerce-core/catalog/files";
import { productTypeDefinition } from "@repo/commerce-core/catalog/product-model";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  MigrationDefinitionRegistry,
  MigrationReferenceLookup,
  SourceIdentity,
  Tracking,
} from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationStore,
  MigrationStoreError,
} from "migrate-sdk";

import type { CatalogDestination } from "./destination";
import { productTypes } from "./schema";

const identity = SourceIdentity.make({
  id: "catalog-key@v1",
  schema: SourceIdentity.key("key", Schema.NonEmptyString),
});
const IdTracking = Tracking.record({
  id: "commercetools-resource@v1",
  schema: Schema.Struct({ id: Schema.String }),
});
const CategoryMembership = Schema.Struct({
  productKey: Schema.NonEmptyString,
  categoryKeys: Schema.Array(Schema.NonEmptyString),
});
const InventoryItem = Schema.Struct({
  productKey: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  quantity: Schema.Int,
});

export const catalogSelectionProductsId = (name: CatalogName) =>
  `${name}-selection-products`;
export const catalogProductsId = (name: CatalogName) => `${name}-products`;

export const trackedId = (
  definition: AnySelfContainedMigrationDefinition,
  key: string
) =>
  Effect.gen(function* () {
    const references = yield* MigrationReferenceLookup;
    const reference = yield* references.lookup({
      definition,
      sourceIdentityKey: key,
    });
    if (reference?.status !== "migrated") {
      return yield* new DestinationError({
        message: `${definition.id}: no successful record for ${key}`,
      });
    }
    if (!Schema.is(IdTracking.schema)(reference.trackingRecord)) {
      return yield* new DestinationError({
        message: `${definition.id}: invalid tracked resource for ${key}`,
      });
    }
    return reference.trackingRecord.id;
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DestinationError
        ? cause
        : new DestinationError({
            cause,
            message: `${definition.id}: cannot resolve the tracked resource for ${key}`,
          })
    )
  );

export const makeCatalogRegistry = (options: {
  readonly store: Layer.Layer<MigrationStore, MigrationStoreError>;
  readonly destination: CatalogDestination;
  readonly catalogs?: Readonly<Record<string, Catalog>>;
  readonly readers?: CatalogReaders;
}) => {
  const { destination, store } = options;
  const readers =
    options.readers ??
    (options.catalogs
      ? Object.fromEntries(
          Object.entries(options.catalogs).map(([name, catalog]) => [
            name,
            () => catalog,
          ])
        )
      : catalogReaders());
  const makeCatalog = (name: CatalogName) => {
    const read = Effect.try({
      try: catalogByName(readers, name),
      catch: (cause) =>
        new DestinationError({
          cause,
          message: `Unable to read catalog ${name}`,
        }),
    });
    const source = <A>(
      schema: Schema.Codec<A, unknown>,
      select: (catalog: Catalog) => readonly DocumentRow<A>[]
    ) =>
      documentRows(
        Schema.toType(schema),
        read.pipe(Effect.map(select)),
        identity
      );
    const definitions = MigrationDefinition.make({
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-product-type-definitions`,
      process: ({
        item: {
          item: { payload: item },
        },
      }) =>
        destination
          .ensureProductType(item)
          .pipe(Effect.flatMap((id) => Tracking.setRecord({ id }))),
      source: source(Schema.String, ({ products }) =>
        productTypes
          .filter(({ key }) =>
            products.some(({ productType }) => productType === key)
          )
          .map((draft) => ({
            item: draft.key,
            key: draft.key,
            inputs: Schema.decodeUnknownSync(Schema.Json)(draft),
          }))
      ),
      store,
      tracking: IdTracking,
    });
    const collection = MigrationDefinition.make({
      group: name,
      id: `${name}-selection`,
      process: () =>
        destination
          .ensureSelection(name)
          .pipe(Effect.flatMap((id) => Tracking.setRecord({ id }))),
      source: source(Schema.String, ({ products }) => [
        {
          key: name,
          item: name,
          inputs: products.flatMap(({ variants }) =>
            variants.map(({ sku }) => sku)
          ),
        },
      ]),
      store,
      tracking: IdTracking,
    });
    const categories = MigrationDefinition.make({
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-categories`,
      process: (entry) =>
        destination
          .upsertCategory(name, entry.item.item.payload)
          .pipe(Effect.flatMap((id) => Tracking.setRecord({ id }))),
      source: source(CatalogCategory, ({ categories, defaultLocale }) =>
        categories.map((item) => ({
          item,
          key: item.key,
          inputs: defaultLocale,
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const importedProducts = MigrationDefinition.make({
      dependencies: { required: [definitions.id, collection.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: catalogProductsId(name),
      process: Effect.fn("CommercetoolsCatalog.upsertProduct")(
        function* (entry) {
          yield* trackedId(definitions, entry.item.item.payload.productType);
          yield* trackedId(collection, name);
          const id = yield* destination.upsertProduct(
            name,
            entry.item.item.payload
          );
          yield* Tracking.setRecord({ id });
        }
      ),
      source: source(CatalogProductContent, ({ products, defaultLocale }) =>
        products.map((product) => ({
          key: product.key,
          item: catalogProductContent(product),
          inputs: [
            defaultLocale,
            JSON.stringify(productTypeDefinition(product.productType)),
          ],
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const categoryProducts = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id, categories.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-category-products`,
      process: Effect.fn("CommercetoolsCatalog.addProductCategories")(
        function* (entry) {
          const id = yield* trackedId(
            importedProducts,
            entry.item.item.payload.productKey
          );
          const categoryIds = yield* Effect.forEach(
            entry.item.item.payload.categoryKeys,
            (key) => trackedId(categories, key),
            { concurrency: 1 }
          );
          yield* destination.addProductCategories(id, categoryIds);
          yield* Tracking.setRecord({ id });
        }
      ),
      source: source(CategoryMembership, ({ products }) =>
        products.map((product) => ({
          key: product.key,
          item: { productKey: product.key, categoryKeys: product.categoryKeys },
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const productReferences = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-product-references`,
      process: Effect.fn("CommercetoolsCatalog.assignProductReferences")(
        function* (entry) {
          const product = entry.item.item.payload;
          const id = yield* trackedId(importedProducts, product.key);
          const relatedIds = yield* Effect.forEach(
            product.relatedProductKeys,
            (key) => trackedId(importedProducts, key),
            { concurrency: 1 }
          );
          const references = yield* Effect.forEach(
            catalogReferenceKeys(product),
            (key) =>
              trackedId(importedProducts, key).pipe(
                Effect.map((referenceId) => [key, referenceId] as const)
              )
          );
          yield* destination.assignProductReferences(
            product,
            id,
            relatedIds,
            Object.fromEntries(references)
          );
          yield* Tracking.setRecord({ id });
        }
      ),
      source: source(CatalogProductReferences, ({ products }) =>
        products.map((product) => ({
          key: product.key,
          item: catalogProductReferences(product),
          inputs: JSON.stringify(productTypeDefinition(product.productType)),
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const inventory = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-inventory`,
      process: Effect.fn("CommercetoolsCatalog.upsertInventory")(
        function* (entry) {
          yield* trackedId(
            importedProducts,
            entry.item.item.payload.productKey
          );
          const id = yield* destination.upsertInventory(
            entry.item.item.payload.sku,
            entry.item.item.payload.quantity
          );
          yield* Tracking.setRecord({ id });
        }
      ),
      source: source(InventoryItem, ({ products }) =>
        products.flatMap((product) =>
          product.variants.map(({ sku, quantity }) => ({
            key: sku,
            item: { productKey: product.key, sku, quantity },
          }))
        )
      ),
      store,
      tracking: IdTracking,
    });
    const selectionProducts = MigrationDefinition.make({
      dependencies: {
        required: [
          collection.id,
          importedProducts.id,
          categoryProducts.id,
          productReferences.id,
        ],
      },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: catalogSelectionProductsId(name),
      process: Effect.fn("CommercetoolsCatalog.assignSelectionProduct")(
        function* (entry) {
          const key = entry.item.item.payload;
          const id = yield* trackedId(importedProducts, key);
          const selectionId = yield* trackedId(collection, name);
          yield* trackedId(categoryProducts, key);
          yield* trackedId(productReferences, key);
          yield* destination.assignSelectionProduct(id, selectionId);
          yield* Tracking.setRecord({ id });
        }
      ),
      source: source(Schema.String, ({ products }) =>
        products.map(({ key }) => ({ item: key, key }))
      ),
      store,
      tracking: IdTracking,
    });
    return [
      definitions,
      collection,
      categories,
      importedProducts,
      categoryProducts,
      productReferences,
      inventory,
      selectionProducts,
    ] as const;
  };
  return MigrationDefinitionRegistry.make({
    definitions: Object.keys(readers).flatMap(makeCatalog),
  });
};
