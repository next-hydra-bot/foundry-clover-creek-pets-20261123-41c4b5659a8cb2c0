import type {
  ByProjectKeyRequestBuilder,
  TaxCategoryUpdateAction,
} from "@commercetools/platform-sdk";
import {
  makeJsonMigration,
  ProvisionedResource,
  readSourceFile,
} from "@repo/cli-core/json-migrations";
import {
  CatalogTaxSetup,
  validateTaxClassMappings,
} from "@repo/commerce-core/catalog/tax";
import {
  loadProvisioningCatalog,
  readProfileDocument,
} from "@repo/commerce-core/provisioning/pipeline";
import type {
  CustomerProvisioningTargets,
  ProfilePreparation,
  ProvisioningCatalog,
  ProvisioningStore,
} from "@repo/commerce-core/provisioning/pipeline";
import {
  loadTaxSetup,
  makeTaxDefinition,
} from "@repo/commerce-core/provisioning/tax";
import { Effect, Schema } from "effect";
import { DestinationError, MigrationReferenceLookup } from "migrate-sdk";

import { recordCatalogChange } from "../catalog/journal";

const NativeKey = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{2,256}$/u)
);
export const TaxRate = Schema.Struct({
  amount: Schema.Finite.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1)
  ),
  country: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/u)),
  includedInPrice: Schema.Boolean,
  key: NativeKey,
  name: Schema.NonEmptyString,
  state: Schema.optionalKey(Schema.NonEmptyString),
});
export const CommercetoolsTaxConfig = Schema.Struct({
  classes: Schema.NonEmptyArray(
    Schema.Struct({
      taxClassKey: Schema.NonEmptyString,
      taxCategoryKey: NativeKey,
      rates: Schema.NonEmptyArray(TaxRate),
    })
  ),
  countryTaxRateFallbackEnabled: Schema.optionalKey(Schema.Boolean),
  shippingMethods: Schema.Array(
    Schema.Struct({
      shippingMethodKey: NativeKey,
      taxClassKey: Schema.NonEmptyString,
    })
  ),
});
export type CommercetoolsTaxConfig = typeof CommercetoolsTaxConfig.Type;

export const validateTaxConfig = (
  setup: CatalogTaxSetup,
  config: CommercetoolsTaxConfig
) => {
  validateTaxClassMappings(
    setup,
    config.classes.map(({ taxClassKey }) => taxClassKey)
  );
  if (
    new Set(config.classes.map(({ taxCategoryKey }) => taxCategoryKey)).size !==
    config.classes.length
  ) {
    throw new Error(
      "Map each Tax Class to a different native Tax Category key."
    );
  }
  for (const mapping of config.classes) {
    if (
      new Set(mapping.rates.map(({ key }) => key)).size !==
        mapping.rates.length ||
      new Set(
        mapping.rates.map(({ country, state }) =>
          JSON.stringify([country, state])
        )
      ).size !== mapping.rates.length
    ) {
      throw new Error(
        `Tax rate keys and country/state pairs must be unique: ${mapping.taxClassKey}`
      );
    }
  }
  if (
    new Set(
      config.shippingMethods.map(({ shippingMethodKey }) => shippingMethodKey)
    ).size !== config.shippingMethods.length ||
    config.shippingMethods.some(
      ({ taxClassKey }) => !setup.classes.some(({ key }) => key === taxClassKey)
    )
  ) {
    throw new Error(
      "Shipping Method tax mappings must have unique native keys and reference a declared Tax Class."
    );
  }
};

const request = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      new DestinationError({
        cause,
        message: `Commercetools tax setup failed: ${operation}. Check provisioning scopes and native resource versions.`,
      }),
    try: run,
  });

type TaxClient = Effect.Effect<ByProjectKeyRequestBuilder, DestinationError>;
const CategoryInput = Schema.Struct({
  ...CommercetoolsTaxConfig.fields.classes.value.fields,
  classification: CatalogTaxSetup.fields.classes.value,
});

const ensureTaxCategory = (
  client: TaxClient,
  mapping: typeof CategoryInput.Type
) =>
  Effect.gen(function* () {
    const api = yield* client;
    const { classification } = mapping;
    const [current] = (yield* request(
      `read Tax Category ${mapping.taxCategoryKey}`,
      async () =>
        await api
          .taxCategories()
          .get({
            queryArgs: {
              limit: 1,
              where: `key=${JSON.stringify(mapping.taxCategoryKey)}`,
            },
          })
          .execute()
    )).body.results;
    if (!current) {
      const created = (yield* request(
        `create Tax Category ${mapping.taxCategoryKey}`,
        async () =>
          await api
            .taxCategories()
            .post({
              body: {
                description: classification.description,
                key: mapping.taxCategoryKey,
                name: classification.name,
                rates: [...mapping.rates],
              },
            })
            .execute()
      )).body;
      yield* recordCatalogChange("tax-category.create", created);
      return created.id;
    }
    const actions: TaxCategoryUpdateAction[] = [];
    if (current.name !== classification.name) {
      actions.push({ action: "changeName", name: classification.name });
    }
    if (current.description !== classification.description) {
      actions.push({
        action: "setDescription",
        description: classification.description,
      });
    }
    for (const rate of mapping.rates) {
      const existing = current.rates.find(({ key }) => key === rate.key);
      const conflict = current.rates.find(
        (candidate) =>
          candidate.country === rate.country &&
          candidate.state === rate.state &&
          candidate.key !== rate.key
      );
      if (conflict) {
        return yield* new DestinationError({
          message: `Tax Category ${mapping.taxCategoryKey} already has a differently keyed rate for ${rate.country}/${rate.state ?? "country"}. Reconcile it explicitly.`,
        });
      }
      if (!existing) {
        actions.push({ action: "addTaxRate", taxRate: rate });
      } else if (
        existing.name !== rate.name ||
        existing.country !== rate.country ||
        existing.state !== rate.state ||
        existing.amount !== rate.amount ||
        existing.includedInPrice !== rate.includedInPrice ||
        (existing.subRates?.length ?? 0) > 0
      ) {
        actions.push({
          action: "replaceTaxRate",
          taxRate: rate,
          taxRateKey: rate.key,
        });
      }
    }
    if (actions.length) {
      const { body } = yield* request(
        `update Tax Category ${mapping.taxCategoryKey}`,
        async () =>
          await api
            .taxCategories()
            .withId({ ID: current.id })
            .post({ body: { version: current.version, actions } })
            .execute()
      );
      yield* recordCatalogChange("tax-category.update", body);
    }
    return current.id;
  });

const ensureProjectTaxFallback = (client: TaxClient, fallback: boolean) =>
  Effect.gen(function* () {
    const api = yield* client;
    const project = (yield* request(
      "read project tax settings",
      async () => await api.get().execute()
    )).body;
    if ((project.carts.countryTaxRateFallbackEnabled ?? false) !== fallback) {
      const { body } = yield* request(
        "set country tax rate fallback",
        async () =>
          await api
            .post({
              body: {
                actions: [
                  {
                    action: "changeCountryTaxRateFallbackEnabled",
                    countryTaxRateFallbackEnabled: fallback,
                  },
                ],
                version: project.version,
              },
            })
            .execute()
      );
      yield* recordCatalogChange("project.set-tax-fallback", {
        id: body.key,
        version: body.version,
      });
    }
  });

const assignProductTaxCategory = (
  client: TaxClient,
  productKey: string,
  productId: string,
  id: string
) =>
  Effect.gen(function* () {
    const api = yield* client;
    const product = (yield* request(
      `read Product ${productKey}`,
      async () => await api.products().withId({ ID: productId }).get().execute()
    )).body;
    if (product.taxCategory?.id !== id) {
      const { body } = yield* request(
        `assign Product ${productKey}`,
        async () =>
          await api
            .products()
            .withId({ ID: product.id })
            .post({
              body: {
                version: product.version,
                actions: [
                  {
                    action: "setTaxCategory",
                    taxCategory: { typeId: "tax-category", id },
                  },
                ],
              },
            })
            .execute()
      );
      yield* recordCatalogChange("product.assign-tax-category", body);
    }
  });

const assignShippingTaxCategory = (
  client: TaxClient,
  shippingMethodKey: string,
  id: string
) =>
  Effect.gen(function* () {
    const api = yield* client;
    const shipping = (yield* request(
      `read Shipping Method ${shippingMethodKey}`,
      async () =>
        await api
          .shippingMethods()
          .withKey({ key: shippingMethodKey })
          .get()
          .execute()
    )).body;
    if (shipping.taxCategory.id !== id) {
      const { body } = yield* request(
        `assign Shipping Method ${shippingMethodKey}`,
        async () =>
          await api
            .shippingMethods()
            .withId({ ID: shipping.id })
            .post({
              body: {
                version: shipping.version,
                actions: [
                  {
                    action: "changeTaxCategory",
                    taxCategory: { typeId: "tax-category", id },
                  },
                ],
              },
            })
            .execute()
      );
      yield* recordCatalogChange("shipping-method.assign-tax-category", body);
    }
    return shipping.id;
  });

export const applyTaxSetup = (
  client: TaxClient,
  setup: CatalogTaxSetup,
  config: CommercetoolsTaxConfig,
  products: ReadonlyMap<string, string>
) =>
  Effect.gen(function* () {
    const categoryIds = new Map<string, string>();
    for (const mapping of config.classes) {
      const classification = setup.classes.find(
        ({ key }) => key === mapping.taxClassKey
      );
      if (!classification) {
        return yield* new DestinationError({
          message: `Unknown Tax Class: ${mapping.taxClassKey}`,
        });
      }
      categoryIds.set(
        mapping.taxClassKey,
        yield* ensureTaxCategory(client, { ...mapping, classification })
      );
    }
    if (config.countryTaxRateFallbackEnabled !== undefined) {
      yield* ensureProjectTaxFallback(
        client,
        config.countryTaxRateFallbackEnabled
      );
    }
    for (const assignment of setup.products) {
      const id = categoryIds.get(assignment.taxClassKey);
      const productId = products.get(assignment.productKey);
      if (!id || !productId) {
        return yield* new DestinationError({
          message: `Missing Product or Tax Category for ${assignment.productKey}`,
        });
      }
      yield* assignProductTaxCategory(
        client,
        assignment.productKey,
        productId,
        id
      );
    }
    for (const assignment of config.shippingMethods) {
      const id = categoryIds.get(assignment.taxClassKey);
      if (!id) {
        return yield* new DestinationError({
          message: `Missing native Tax Category: ${assignment.taxClassKey}`,
        });
      }
      yield* assignShippingTaxCategory(
        client,
        assignment.shippingMethodKey,
        id
      );
    }
  });

const categoryKey = (
  config: typeof CommercetoolsTaxConfig.Type,
  taxClassKey: string
) => {
  const mapping = config.classes.find(
    (entry) => entry.taxClassKey === taxClassKey
  );
  if (!mapping) {
    throw new Error(`Missing native Tax Category for ${taxClassKey}`);
  }
  return mapping.taxCategoryKey;
};

export const withTaxSetup = <T extends CustomerProvisioningTargets>(
  options: ProfilePreparation,
  targets: T,
  client: Effect.Effect<ByProjectKeyRequestBuilder, DestinationError>
) =>
  Effect.gen(function* () {
    const tax = yield* loadTaxSetup(options);
    if (!tax) {
      return targets;
    }
    const loadConfig = readProfileDocument(
      CommercetoolsTaxConfig,
      tax.configFile
    ).pipe(
      Effect.mapError(
        (cause) =>
          new DestinationError({
            cause,
            message: "Invalid Commercetools --tax-config JSON.",
          })
      )
    );
    const config = yield* loadConfig;
    const readConfig = readSourceFile(loadConfig);
    const readTax = Effect.all({ setup: tax.read, config: readConfig }).pipe(
      Effect.mapError(
        (cause) =>
          new DestinationError({ cause, message: "Unable to read tax sources" })
      )
    );
    const readCatalog = readSourceFile(
      loadProvisioningCatalog(options.directory)
    );
    yield* Effect.try({
      catch: (cause) =>
        new DestinationError({
          cause,
          message:
            cause instanceof Error
              ? cause.message
              : "Invalid Commercetools tax mappings.",
        }),
      try: () => {
        validateTaxConfig(tax.setup, config);
      },
    });
    return {
      ...targets,
      catalogDefinitions: (
        catalog: ProvisioningCatalog,
        store: ProvisioningStore
      ) => {
        const definitions = targets.catalogDefinitions(catalog, store);
        const categories = Effect.runSync(
          makeJsonMigration({
            id: "commercetools-tax-categories",
            group: "provision",
            input: {
              schema: CategoryInput,
              read: readTax.pipe(
                Effect.map(({ config, setup }) =>
                  config.classes.map((mapping) => {
                    const classification = setup.classes.find(
                      ({ key }) => key === mapping.taxClassKey
                    );
                    if (!classification) {
                      throw new Error(
                        `Unknown Tax Class: ${mapping.taxClassKey}`
                      );
                    }
                    return { ...mapping, classification };
                  })
                )
              ),
              key: ({ taxClassKey }) => taxClassKey,
            },
            destination: {
              entity: ProvisionedResource,
              reference: (resource) => resource,
              write: (input) =>
                ensureTaxCategory(client, input).pipe(
                  Effect.map((id) => ({ id, key: input.taxClassKey }))
                ),
            },
            revision: "tax-category-v1",
            store,
          })
        );
        const shipping = Effect.runSync(
          makeJsonMigration({
            id: "commercetools-shipping-tax-assignments",
            group: "provision",
            dependencies: [categories],
            input: {
              schema: Schema.Struct({
                ...CommercetoolsTaxConfig.fields.shippingMethods.value.fields,
                taxCategoryKey: NativeKey,
              }),
              read: readConfig.pipe(
                Effect.map((config) =>
                  config.shippingMethods.map((item) => ({
                    ...item,
                    taxCategoryKey: categoryKey(config, item.taxClassKey),
                  }))
                )
              ),
              key: ({ shippingMethodKey }) => shippingMethodKey,
            },
            destination: {
              entity: ProvisionedResource,
              reference: (resource) => resource,
              write: (input, references) =>
                Effect.gen(function* () {
                  const category = yield* references.get(
                    categories,
                    input.taxClassKey
                  );
                  const id = yield* assignShippingTaxCategory(
                    client,
                    input.shippingMethodKey,
                    category.id
                  );
                  return { id, key: input.shippingMethodKey };
                }),
            },
            revision: "shipping-tax-v1",
            store,
          })
        );
        const project = Effect.runSync(
          makeJsonMigration({
            id: "commercetools-project-tax-settings",
            group: "provision",
            input: {
              schema: Schema.Boolean,
              read: readConfig.pipe(
                Effect.map(({ countryTaxRateFallbackEnabled: fallback }) =>
                  fallback === undefined ? [] : [fallback]
                )
              ),
              key: () => "country-tax-rate-fallback",
            },
            destination: {
              entity: ProvisionedResource,
              reference: (resource) => resource,
              write: (enabled) =>
                ensureProjectTaxFallback(client, enabled).pipe(
                  Effect.as({
                    id: "country-tax-rate-fallback",
                    key: "country-tax-rate-fallback",
                  })
                ),
            },
            revision: "project-tax-v1",
            store,
          })
        );
        return [
          ...definitions,
          categories,
          shipping,
          project,
          makeTaxDefinition({
            apply: (products) =>
              Effect.gen(function* () {
                const { setup } = yield* readTax;
                const lookup = yield* MigrationReferenceLookup;
                for (const [key, id] of products) {
                  const assignment = setup.products.find(
                    ({ productKey }) => productKey === key
                  );
                  if (!assignment) {
                    return yield* new DestinationError({
                      message: `Missing Product tax assignment: ${key}`,
                    });
                  }
                  const category = yield* lookup
                    .lookup({
                      definition: categories,
                      sourceIdentityKey: assignment.taxClassKey,
                    })
                    .pipe(
                      Effect.mapError(
                        (cause) =>
                          new DestinationError({
                            cause,
                            message: `Could not resolve Tax Category ${assignment.taxClassKey}`,
                          })
                      )
                    );
                  if (category?.status !== "migrated") {
                    return yield* new DestinationError({
                      message: `Tax Category is unavailable: ${assignment.taxClassKey}`,
                    });
                  }
                  yield* assignProductTaxCategory(
                    client,
                    key,
                    id,
                    category.trackingRecord.id
                  );
                }
              }),
            dependencies: [categories],
            productDefinitions: definitions.filter(
              ({ id }) => id === `${catalog.files.catalogName}-products`
            ),
            readProducts: Effect.all({
              catalog: readCatalog,
              tax: readTax,
            }).pipe(
              Effect.map(({ catalog, tax: { setup, config } }) =>
                Object.entries(catalog.catalogs).flatMap(([name, source]) => {
                  const definition = definitions.find(
                    ({ id }) => id === `${name}-products`
                  );
                  if (!definition) {
                    throw new Error(
                      `Missing catalog Product definition: ${name}`
                    );
                  }
                  return source.products.map(({ key }) => {
                    const assignment = setup.products.find(
                      ({ productKey }) => productKey === key
                    );
                    return {
                      definition,
                      key,
                      versionInputs: [
                        assignment?.taxClassKey ?? null,
                        config.classes.find(
                          (item) => item.taxClassKey === assignment?.taxClassKey
                        )?.taxCategoryKey ?? null,
                      ],
                    };
                  });
                })
              )
            ),
            revision: ["commercetools-product-tax-v2"],
            store,
          }),
        ];
      },
    };
  });
