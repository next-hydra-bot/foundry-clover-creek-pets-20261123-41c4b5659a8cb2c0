import { isDeepStrictEqual } from "node:util";

import type { ApiRoot, ProductVariant } from "@commercetools/platform-sdk";
import { CommercetoolsSdk } from "@migrate-sdk/commercetools";
import {
  CommercetoolsDestination,
  nonEmptyUpdateActions,
} from "@migrate-sdk/commercetools/destination";
import type { ProductUpdateAction } from "@migrate-sdk/commercetools/destination";
import type {
  Catalog,
  CatalogCategory,
  CatalogName,
  CatalogProductContent,
  CatalogProductReferences,
} from "@repo/commerce-core/catalog";
import {
  catalogReaders,
  catalogByName,
} from "@repo/commerce-core/catalog/files";
import { productTypeDefinition } from "@repo/commerce-core/catalog/product-model";
import { Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import { recordCatalogChange } from "./journal";
import {
  discountKey,
  categoryDraft,
  nativeImage,
  productDraft,
  selectionKey,
  variantAttributes,
  variantKey,
  variantPrice,
} from "./mapping";
import { productTypes } from "./schema";

export const makeCatalogSdk = (apiRoot: ApiRoot, projectKey: string) => {
  const layer = CommercetoolsSdk.layerFromApiRoot({ apiRoot, projectKey });
  return {
    apiRoot: apiRoot.withProjectKey({ projectKey }),
    write: CommercetoolsDestination.make().provide(layer),
  };
};

export type CatalogSdk = ReturnType<typeof makeCatalogSdk>;

export interface CatalogClient extends CatalogSdk {
  readonly storeKey: string;
  readonly distributionChannelId: string;
  readonly supplyChannelId?: string;
}
const fail = (message: string) => new DestinationError({ message });
// Convert native SDK failures into Migrate item failures at the transport boundary.
const request = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      new DestinationError({
        cause,
        message: "Commercetools catalog request failed",
      }),
    try: operation,
  });
const predicate = (key: string) => `key=${JSON.stringify(key)}`;
export const makeCatalogDestination = (
  client: Effect.Effect<CatalogClient, DestinationError>,
  catalogs?: Readonly<Record<string, Catalog>>,
  readers = catalogReaders()
) => {
  const readCatalog = catalogs
    ? (name: CatalogName) => catalogByName(catalogs, name)
    : (name: CatalogName) => catalogByName(readers, name)();
  const salePredicate = (name: CatalogName) =>
    readCatalog(name)
      .products.flatMap(({ variants }) =>
        variants.map(({ sku }) => `sku = ${JSON.stringify(sku)}`)
      )
      .join(" or ");

  const storeTarget = Effect.gen(function* () {
    const { apiRoot, storeKey, distributionChannelId, write } = yield* client;
    const store = (yield* request(
      async () =>
        await apiRoot.stores().withKey({ key: storeKey }).get().execute()
    )).body;
    const distribution = store.distributionChannels.find(
      ({ id }) => id === distributionChannelId
    );
    if (distribution === undefined) {
      return yield* fail(
        "The catalog Store needs the configured price distribution channel"
      );
    }
    return { apiRoot, distributionChannelId, write };
  });
  const target = (name: CatalogName) =>
    Effect.gen(function* () {
      const destination = yield* storeTarget;
      const { apiRoot } = destination;
      const [discount] = (yield* request(
        async () =>
          await apiRoot
            .productDiscounts()
            .get({
              queryArgs: { limit: 1, where: predicate(discountKey(name)) },
            })
            .execute()
      )).body.results;
      if (discount === undefined) {
        return yield* fail("Catalog price discount has not been provisioned");
      }
      return { ...destination, discountId: discount.id };
    });
  const ensureProductType = (key: string) =>
    Effect.gen(function* () {
      const { apiRoot } = yield* client;
      const draft = productTypes.find((type) => type.key === key);
      if (draft === undefined) {
        return yield* fail(`Unknown catalog Product Type: ${key}`);
      }
      const [current] = (yield* request(
        async () =>
          await apiRoot
            .productTypes()
            .get({ queryArgs: { limit: 1, where: predicate(key) } })
            .execute()
      )).body.results;
      if (current === undefined) {
        const { body } = yield* request(
          async () =>
            await apiRoot.productTypes().post({ body: draft }).execute()
        );
        yield* recordCatalogChange("product-type.create", body);
        return body.id;
      }
      for (const attribute of draft.attributes) {
        const existing = current.attributes?.find(
          ({ name }) => name === attribute.name
        );
        if (
          existing === undefined ||
          !isDeepStrictEqual(existing.type, attribute.type) ||
          existing.isRequired !== attribute.isRequired ||
          existing.attributeConstraint !== attribute.attributeConstraint
        ) {
          return yield* fail(
            `Product Type ${key}.${attribute.name} differs from the JSON product model; reconcile it with the commerce schema migration before importing`
          );
        }
      }
      return current.id;
    });
  const ensureSelection = (name: CatalogName) =>
    Effect.gen(function* () {
      const { apiRoot, storeKey, write } = yield* client;
      const key = selectionKey(name);
      let [selection] = (yield* request(
        async () =>
          await apiRoot
            .productSelections()
            .get({ queryArgs: { limit: 1, where: predicate(key) } })
            .execute()
      )).body.results;
      selection ??= yield* write.productSelections.create({
        key,
        mode: "Individual",
        name: { "en-US": `Starter ${name} catalog` },
      });
      if (selection.mode !== "Individual") {
        return yield* fail("Catalog selection must use Individual mode");
      }
      const discounts = (yield* request(
        async () =>
          await apiRoot
            .productDiscounts()
            .get({
              queryArgs: { limit: 1, where: predicate(discountKey(name)) },
            })
            .execute()
      )).body.results;
      const [discount] = discounts;
      const expectedPredicate = salePredicate(name);
      if (discount === undefined) {
        const { body } = yield* request(
          async () =>
            await apiRoot
              .productDiscounts()
              .post({
                body: {
                  isActive: true,
                  key: discountKey(name),
                  name: { "en-US": `Starter ${name} prices` },
                  predicate: expectedPredicate,
                  sortOrder: name === "b2b" ? "0.982681" : "0.982682",
                  value: { type: "external" },
                },
              })
              .execute()
        );
        yield* recordCatalogChange("product-discount.create", body);
      } else if (discount.value.type !== "external" || !discount.isActive) {
        return yield* fail(
          "The catalog external price discount has changed; reconcile it before importing"
        );
      }
      if (discount !== undefined && discount.predicate !== expectedPredicate) {
        const { body } = yield* request(
          async () =>
            await apiRoot
              .productDiscounts()
              .withId({ ID: discount.id })
              .post({
                body: {
                  actions: [
                    { action: "changePredicate", predicate: expectedPredicate },
                  ],
                  version: discount.version,
                },
              })
              .execute()
        );
        yield* recordCatalogChange("product-discount.update", body);
      }
      const store = (yield* request(
        async () =>
          await apiRoot.stores().withKey({ key: storeKey }).get().execute()
      )).body;
      const assignment = store.productSelections?.find(
        ({ productSelection }) => productSelection.id === selection.id
      );
      if (assignment === undefined || !assignment.active) {
        const action =
          assignment === undefined
            ? "addProductSelection"
            : "changeProductSelectionActive";
        yield* write.stores.update({
          actions: [
            {
              action,
              active: true,
              productSelection: {
                id: selection.id,
                typeId: "product-selection",
              },
            },
          ],
          selector: { kind: "key", key: storeKey },
          version: store.version,
        });
      }
      return selection.id;
    });
  const upsertCategory = (name: CatalogName, category: CatalogCategory) =>
    Effect.gen(function* () {
      const { apiRoot } = yield* client;
      const draft = categoryDraft(
        name,
        category,
        readCatalog(name).defaultLocale
      );
      const [existing] = (yield* request(
        async () =>
          await apiRoot
            .categories()
            .get({ queryArgs: { limit: 1, where: predicate(category.key) } })
            .execute()
      )).body.results;
      if (existing === undefined) {
        const { body } = yield* request(
          async () => await apiRoot.categories().post({ body: draft }).execute()
        );
        yield* recordCatalogChange("category.create", body);
        return body.id;
      }
      if (existing.externalId !== draft.externalId) {
        return yield* fail(
          `Category is not owned by this catalog: ${category.key}`
        );
      }
      const { body } = yield* request(
        async () =>
          await apiRoot
            .categories()
            .withId({ ID: existing.id })
            .post({
              body: {
                actions: [
                  { action: "changeName", name: draft.name },
                  { action: "changeSlug", slug: draft.slug },
                  { action: "setDescription", description: draft.description },
                ],
                version: existing.version,
              },
            })
            .execute()
      );
      yield* recordCatalogChange("category.update", body);
      return body.id;
    });
  const upsertProduct = (name: CatalogName, product: CatalogProductContent) =>
    Effect.gen(function* () {
      const destination = yield* target(name);
      const { apiRoot, write } = destination;
      const [current] = (yield* request(
        async () =>
          await apiRoot
            .products()
            .get({ queryArgs: { limit: 1, where: predicate(product.key) } })
            .execute()
      )).body.results;
      if (current === undefined) {
        const created = yield* write.products.create(
          productDraft(
            name,
            product,
            destination,
            readCatalog(name).defaultLocale
          )
        );
        yield* write.products.update({
          actions: [{ action: "publish" }],
          selector: { kind: "id", id: created.id },
          version: created.version,
        });
        return created.id;
      }
      const existing = [
        current.masterData.staged.masterVariant,
        ...current.masterData.staged.variants,
      ];
      const staged = !current.masterData.published;
      const live = staged
        ? existing
        : [
            current.masterData.current.masterVariant,
            ...current.masterData.current.variants,
          ];
      if (
        existing.some(
          ({ sku, key }) =>
            sku === undefined ||
            key !== variantKey(name, sku) ||
            !product.variants.some((variant) => variant.sku === sku)
        )
      ) {
        return yield* fail(
          `Product ${product.key} is not owned by this catalog or has unexpected variants`
        );
      }
      if (
        live.length !== existing.length ||
        live.some(
          ({ id, key, sku }) =>
            !existing.some(
              (variant) =>
                variant.id === id && variant.key === key && variant.sku === sku
            )
        )
      ) {
        return yield* fail(
          `Product ${product.key} has different current and staged variants; resolve the pending variant changes before importing`
        );
      }
      const type = (yield* request(
        async () =>
          await apiRoot
            .productTypes()
            .withKey({ key: product.productType })
            .get()
            .execute()
      )).body;
      if (type.id !== current.productType.id) {
        return yield* fail(`Product Type changed for ${product.key}`);
      }
      const draft = productDraft(
        name,
        product,
        destination,
        readCatalog(name).defaultLocale
      );
      const actions: ProductUpdateAction[] = [
        { action: "changeName", name: draft.name, staged },
        { action: "changeSlug", slug: draft.slug, staged },
        { action: "setDescription", description: draft.description, staged },
      ];
      const commonAttributes = new Set(
        (type.attributes ?? [])
          .filter(
            ({ attributeConstraint }) => attributeConstraint === "SameForAll"
          )
          .map(({ name }) => name)
      );
      const referenceAttributes = new Set(
        productTypeDefinition(product.productType)
          .attributes.filter(({ type }) => type === "product-reference")
          .map(({ key }) => key)
      );
      const firstAttributes = variantAttributes(
        product.variants[0],
        product.productType
      );
      for (const attributeName of commonAttributes) {
        if (!referenceAttributes.has(attributeName)) {
          actions.push({
            action: "setAttributeInAllVariants",
            name: attributeName,
            staged,
            value: firstAttributes.find(({ name }) => name === attributeName)
              ?.value,
          });
        }
      }
      for (const variant of product.variants) {
        const found = existing.find(({ sku }) => sku === variant.sku);
        if (found === undefined) {
          actions.push({
            action: "addVariant",
            attributes: variantAttributes(variant, product.productType).filter(
              ({ name }) => !referenceAttributes.has(name)
            ),
            images: variant.images.map(nativeImage),
            key: variantKey(name, variant.sku),
            prices: [variantPrice(variant, destination)],
            sku: variant.sku,
            staged,
          });
        } else {
          const liveVariant = live.find(({ id }) => id === found.id) ?? found;
          const keepPrices = (native: ProductVariant) =>
            (native.prices ?? []).filter(
              (price) =>
                !(
                  price.channel?.id === destination.distributionChannelId &&
                  price.value.currencyCode ===
                    variant.price.regular.currencyCode &&
                  price.customerGroup === undefined &&
                  price.country === undefined &&
                  price.validFrom === undefined &&
                  price.validUntil === undefined
                )
            );
          const livePrices = keepPrices(liveVariant);
          const stagedPrices = keepPrices(found);
          const price = variantPrice(variant, destination);
          actions.push({
            action: "setPrices",
            prices: [...livePrices, price],
            staged,
            variantId: found.id,
          });
          if (!isDeepStrictEqual(livePrices, stagedPrices)) {
            actions.push({
              action: "setPrices",
              prices: [...stagedPrices, price],
              staged: true,
              variantId: found.id,
            });
          }
          // Native image updates are URL-based; rebuild the owned variant gallery to preserve source order and dimensions.
          const liveImages = new Set(liveVariant.images?.map(({ url }) => url));
          const stagedImages = found.images?.map(({ url }) => url) ?? [];
          for (const url of new Set([...liveImages, ...stagedImages])) {
            actions.push({
              action: "removeImage",
              imageUrl: url,
              staged: staged || !liveImages.has(url),
              variantId: found.id,
            });
          }
          for (const image of variant.images) {
            actions.push({
              action: "addExternalImage",
              image: nativeImage(image),
              staged,
              variantId: found.id,
            });
          }
          for (const attribute of variantAttributes(
            variant,
            product.productType
          )) {
            if (
              !commonAttributes.has(attribute.name) &&
              !referenceAttributes.has(attribute.name)
            ) {
              actions.push({
                action: "setAttribute",
                staged,
                variantId: found.id,
                ...attribute,
              });
            }
          }
          const existingAttributeNames = new Set(
            [
              ...(found.attributes ?? []),
              ...(liveVariant.attributes ?? []),
            ].map(({ name }) => name)
          );
          for (const attribute of existingAttributeNames) {
            if (
              !referenceAttributes.has(attribute) &&
              !commonAttributes.has(attribute) &&
              !Object.hasOwn(variant.attributes, attribute)
            ) {
              actions.push({
                action: "setAttribute",
                name: attribute,
                staged,
                variantId: found.id,
              });
            }
          }
        }
      }
      // A full publish would promote other migrations' fields and merchant edits.
      if (staged) {
        actions.push({ action: "publish" });
      }
      yield* write.products.update({
        actions: nonEmptyUpdateActions(actions, product.key),
        selector: { kind: "id", id: current.id },
        version: current.version,
      });
      return current.id;
    });
  const addProductCategories = (id: string, categoryIds: readonly string[]) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const current = (yield* request(
        async () => await apiRoot.products().withId({ ID: id }).get().execute()
      )).body;
      const { current: live, staged } = current.masterData;
      const actions: ProductUpdateAction[] = [];
      for (const categoryId of new Set(categoryIds)) {
        const inLive = live.categories.some(({ id }) => id === categoryId);
        const inStaged = staged.categories.some(({ id }) => id === categoryId);
        if (inLive && inStaged) {
          continue;
        }
        const orderHint = (inLive ? live : staged).categoryOrderHints?.[
          categoryId
        ];
        const action = {
          action: "addToCategory",
          category: { id: categoryId, typeId: "category" },
          staged: inLive,
        } as const;
        actions.push(
          orderHint === undefined ? action : { ...action, orderHint }
        );
      }
      if (actions.length > 0) {
        yield* write.products.update({
          actions: nonEmptyUpdateActions(actions, id),
          selector: { kind: "id", id },
          version: current.version,
        });
      }
    });
  const assignProductReferences = (
    product: CatalogProductReferences,
    id: string,
    relatedIds: readonly string[],
    referenceIds: Readonly<Record<string, string>>
  ) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const current = (yield* request(
        async () => await apiRoot.products().withId({ ID: id }).get().execute()
      )).body;
      const referenceActions: ProductUpdateAction[] = [];
      if (
        productTypeDefinition(product.productType).attributes.some(
          ({ key }) => key === "relatedProducts"
        )
      ) {
        referenceActions.push({
          action: "setAttributeInAllVariants",
          name: "relatedProducts",
          staged: false,
          value: relatedIds.map((relatedId) => ({
            id: relatedId,
            typeId: "product",
          })),
        });
      }
      for (const attribute of productTypeDefinition(
        product.productType
      ).attributes.filter(
        ({ type, key }) =>
          type === "product-reference" && key !== "relatedProducts"
      )) {
        for (const variant of product.variants) {
          const native = [
            current.masterData.current.masterVariant,
            ...current.masterData.current.variants,
          ].find(({ sku }) => sku === variant.sku);
          if (native === undefined) {
            return yield* fail(`Imported variant is missing: ${variant.sku}`);
          }
          const raw = variant.attributes[attribute.key];
          const resolve = (key: string) => {
            const id = referenceIds[key];
            if (id === undefined) {
              throw new Error(`Unresolved product reference: ${key}`);
            }
            return { id, typeId: "product" };
          };
          let value;
          if (raw !== undefined) {
            value = attribute.list
              ? Schema.decodeUnknownSync(Schema.Array(Schema.String))(raw).map(
                  resolve
                )
              : resolve(Schema.decodeUnknownSync(Schema.String)(raw));
          }
          if (attribute.variantConstraint === "same") {
            referenceActions.push({
              action: "setAttributeInAllVariants",
              name: attribute.key,
              staged: false,
              value,
            });
            break;
          }
          referenceActions.push({
            action: "setAttribute",
            name: attribute.key,
            staged: false,
            value,
            variantId: native.id,
          });
        }
      }
      if (referenceActions.length > 0) {
        yield* write.products.update({
          actions: nonEmptyUpdateActions(referenceActions, product.key),
          selector: { kind: "id", id },
          version: current.version,
        });
      }
    });
  const upsertInventory = (sku: string, quantity: number) =>
    Effect.gen(function* () {
      const { apiRoot, storeKey, supplyChannelId, write } = yield* client;
      const store = (yield* request(
        async () =>
          await apiRoot.stores().withKey({ key: storeKey }).get().execute()
      )).body;
      if (
        !supplyChannelId ||
        !store.supplyChannels.some(({ id }) => id === supplyChannelId)
      ) {
        return yield* fail(
          "The catalog Store needs the configured inventory supply channel"
        );
      }
      const [inventory] = (yield* request(
        async () =>
          await apiRoot
            .inventory()
            .get({
              queryArgs: {
                limit: 1,
                where: `sku=${JSON.stringify(sku)} and supplyChannel(id=${JSON.stringify(supplyChannelId)})`,
              },
            })
            .execute()
      )).body.results;
      if (!inventory) {
        return (yield* write.inventory.create({
          quantityOnStock: quantity,
          sku,
          supplyChannel: { id: supplyChannelId, typeId: "channel" },
        })).id;
      }
      if (inventory.quantityOnStock !== quantity) {
        yield* write.inventory.update({
          actions: [{ action: "changeQuantity", quantity }],
          selector: { kind: "id", id: inventory.id },
          version: inventory.version,
        });
      }
      return inventory.id;
    });
  const assignSelectionProduct = (id: string, collection: string) =>
    Effect.gen(function* () {
      const { apiRoot, write } = yield* client;
      const assignments = (yield* request(
        async () =>
          await apiRoot
            .productSelections()
            .withId({ ID: collection })
            .products()
            .get({
              queryArgs: {
                limit: 1,
                where: `product(id=${JSON.stringify(id)})`,
              },
            })
            .execute()
      )).body.results;
      if (assignments.length === 0) {
        const selection = (yield* request(
          async () =>
            await apiRoot
              .productSelections()
              .withId({ ID: collection })
              .get()
              .execute()
        )).body;
        yield* write.productSelections.update({
          actions: [
            { action: "addProduct", product: { id, typeId: "product" } },
          ],
          selector: { kind: "id", id: collection },
          version: selection.version,
        });
      }
    });
  return {
    addProductCategories,
    assignProductReferences,
    assignSelectionProduct,
    ensureProductType,
    ensureSelection,
    upsertCategory,
    upsertInventory,
    upsertProduct,
  };
};
export type CatalogDestination = ReturnType<typeof makeCatalogDestination>;
