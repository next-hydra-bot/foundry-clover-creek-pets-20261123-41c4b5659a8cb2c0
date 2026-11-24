import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/ts-client";
import {
  catalogReaders,
  loadCompanyCatalogSetup,
} from "@repo/commerce-core/catalog/files";
import type { CatalogMigrationOptions } from "@repo/commerce-core/catalog/files";
import { readShippingSetup } from "@repo/commerce-core/provisioning/shipping";
import { Effect, Schema } from "effect";
import { DestinationError, MigrationDefinitionRegistry } from "migrate-sdk";
import { defineMigrationCliConfig } from "migrate-sdk/cli";
import { FileMigrationStore } from "migrate-sdk/stores/file";

import {
  CompanyCatalogBindings,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Provider-owned migration composition root.
  validateCompanyCatalogBindings,
} from "./b2b";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The CLI config assembles the migration registry.
import { makeCompanyCatalogMigrations } from "./company-migrations";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This Migrate configuration is the import tool composition root.
import { makeCatalogDestination, makeCatalogSdk } from "./destination";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The CLI config assembles the migration registry.
import { makeMarketInventoryMigration } from "./market-inventory";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Registry assembly belongs to the import composition root.
import { catalogProductsId, makeCatalogRegistry } from "./migrations";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The CLI config assembles the migration registry.
import { makeProjectSetupMigrations } from "./project-setup";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- CLI registry assembly.
import { makeShippingMigrations } from "./shipping-migrations";

const ProjectEnvironment = Schema.Struct({
  COMMERCETOOLS_CLIENT_ID: Schema.NonEmptyString,
  COMMERCETOOLS_CLIENT_SECRET: Schema.NonEmptyString,
  COMMERCETOOLS_PROJECT_KEY: Schema.NonEmptyString,
  COMMERCETOOLS_REGION: Schema.String.check(
    Schema.isPattern(/^[a-z0-9-]+\.(?:gcp|aws)$/u)
  ),
  COMMERCETOOLS_SCOPE: Schema.NonEmptyString,
});
const CatalogEnvironment = Schema.Struct({
  COMMERCETOOLS_CATALOG_DISTRIBUTION_CHANNEL_ID: Schema.NonEmptyString,
  COMMERCETOOLS_CATALOG_SUPPLY_CHANNEL_ID: Schema.optionalKey(
    Schema.NonEmptyString
  ),
  COMMERCETOOLS_CATALOG_STORE_KEY: Schema.NonEmptyString,
});
// Caching the lazy credential boundary lets plan/list operate without credentials.
const makeProjectClient = (
  environment: NonNullable<CatalogMigrationOptions["environment"]>
) =>
  Effect.runSync(
    Effect.cached(
      Schema.decodeUnknownEffect(ProjectEnvironment)(environment).pipe(
        Effect.mapError(
          () =>
            new DestinationError({
              message:
                "Configure commercetools project credentials in catalog/.env",
            })
        ),
        Effect.map((environment) => {
          const connection = new ClientBuilder()
            .withProjectKey(environment.COMMERCETOOLS_PROJECT_KEY)
            .withClientCredentialsFlow({
              credentials: {
                clientId: environment.COMMERCETOOLS_CLIENT_ID,
                clientSecret: environment.COMMERCETOOLS_CLIENT_SECRET,
              },
              host: `https://auth.${environment.COMMERCETOOLS_REGION}.commercetools.com`,
              httpClient: fetch,
              projectKey: environment.COMMERCETOOLS_PROJECT_KEY,
              scopes: environment.COMMERCETOOLS_SCOPE.split(" "),
            })
            .withHttpMiddleware({
              enableRetry: false,
              host: `https://api.${environment.COMMERCETOOLS_REGION}.commercetools.com`,
              httpClient: fetch,
            })
            .build();
          return makeCatalogSdk(
            createApiBuilderFromCtpClient(connection),
            environment.COMMERCETOOLS_PROJECT_KEY
          );
        })
      )
    )
  );
export const defineCatalogMigrationConfig = (
  options: CatalogMigrationOptions & {
    readonly shipping?: {
      readonly file: string | URL;
      readonly taxCategoryKey: string;
    };
  }
) => {
  const environmentFile = new URL(".env", import.meta.url);
  if (!options.environment && existsSync(environmentFile)) {
    loadEnvFile(fileURLToPath(environmentFile));
  }
  const environment = options.environment ?? process.env;
  const projectClient = makeProjectClient(environment);
  const catalogClient = Effect.gen(function* () {
    const client = yield* projectClient;
    const target = yield* Schema.decodeUnknownEffect(CatalogEnvironment)(
      environment
    ).pipe(
      Effect.mapError(
        (cause) =>
          new DestinationError({
            cause,
            message:
              "Configure the commercetools catalog Store key and channel IDs",
          })
      )
    );
    return {
      ...client,
      storeKey: target.COMMERCETOOLS_CATALOG_STORE_KEY,
      distributionChannelId:
        target.COMMERCETOOLS_CATALOG_DISTRIBUTION_CHANNEL_ID,
      supplyChannelId: target.COMMERCETOOLS_CATALOG_SUPPLY_CHANNEL_ID,
    };
  });
  const target = createHash("sha256")
    .update(
      JSON.stringify([
        environment.COMMERCETOOLS_PROJECT_KEY,
        environment.COMMERCETOOLS_REGION,
        environment.COMMERCETOOLS_CATALOG_STORE_KEY,
        environment.COMMERCETOOLS_CATALOG_DISTRIBUTION_CHANNEL_ID,
        environment.COMMERCETOOLS_CATALOG_SUPPLY_CHANNEL_ID,
      ])
    )
    .digest("hex");
  const catalogMigrationStore = FileMigrationStore.layer({
    directory: path.join(
      options.stateDirectory instanceof URL
        ? fileURLToPath(options.stateDirectory)
        : options.stateDirectory,
      target
    ),
  });
  const readers = catalogReaders(options.catalogs);
  const registry = makeCatalogRegistry({
    readers,
    destination: makeCatalogDestination(catalogClient, undefined, readers),
    store: catalogMigrationStore,
  });
  const { shipping } = options;
  const shippingDefinitions =
    shipping === undefined
      ? []
      : Effect.runSync(
          Effect.gen(function* () {
            const read = readShippingSetup(shipping.file);
            yield* read;
            const taxCategoryKey = yield* Schema.decodeUnknownEffect(
              Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{2,256}$/u))
            )(shipping.taxCategoryKey);
            return makeShippingMigrations({
              client: projectClient.pipe(Effect.map(({ apiRoot }) => apiRoot)),
              taxCategoryKey,
              read,
              store: catalogMigrationStore,
            });
          })
        );
  const baseDefinitions = [...registry.definitions(), ...shippingDefinitions];
  const { company } = options;
  if (!company) {
    return defineMigrationCliConfig({
      registry: MigrationDefinitionRegistry.make({
        definitions: baseDefinitions,
      }),
    });
  }

  const readSetup = Effect.try({
    try: () => loadCompanyCatalogSetup(company, options.catalogs),
    catch: (cause) =>
      new DestinationError({
        cause,
        message: "Unable to read the company catalog source",
      }),
  });
  const setup = Effect.runSync(readSetup);
  const bindings = Schema.decodeUnknownSync(
    Schema.fromJsonString(CompanyCatalogBindings)
  )(readFileSync(company.bindingsFile, "utf-8"), { onExcessProperty: "error" });
  validateCompanyCatalogBindings(bindings, setup.plans);
  const projectSetup = Effect.runSync(
    makeProjectSetupMigrations({
      bindings,
      client: catalogClient,
      readSetup: readSetup.pipe(
        Effect.map(({ selling, plans }) => ({ stores: selling.stores, plans }))
      ),
      store: catalogMigrationStore,
    })
  );
  const group = "b2b-companies";
  const sourceProducts = baseDefinitions.find(
    ({ id }) => id === catalogProductsId(setup.selling.sourceCatalog)
  );
  if (!sourceProducts) {
    throw new Error(
      `Missing Product migration for ${setup.selling.sourceCatalog}`
    );
  }
  const marketInventory = makeMarketInventoryMigration({
    bindings,
    catalog: setup.selling.sourceCatalog,
    channels: projectSetup.channels,
    client: catalogClient,
    group,
    readPlans: readSetup.pipe(Effect.map(({ plans }) => plans)),
    products: sourceProducts,
    store: catalogMigrationStore,
  });
  const companyDefinitions = Effect.runSync(
    makeCompanyCatalogMigrations({
      bindings,
      channels: projectSetup.channels,
      client: catalogClient,
      group,
      readPlans: readSetup.pipe(Effect.map(({ plans }) => plans)),
      products: sourceProducts,
      sellingKey: setup.selling.key,
      sourceCatalog: setup.selling.sourceCatalog,
      store: catalogMigrationStore,
      stores: projectSetup.stores,
    })
  );
  return defineMigrationCliConfig({
    registry: MigrationDefinitionRegistry.make({
      definitions: [
        ...baseDefinitions,
        ...projectSetup.definitions,
        marketInventory,
        ...companyDefinitions,
      ],
    }),
  });
};
