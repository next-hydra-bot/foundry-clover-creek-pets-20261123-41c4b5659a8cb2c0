import { documentRows } from "@repo/cli-core/json-migrations";
import type { CatalogName } from "@repo/commerce-core/catalog";
import type { CompanyCatalogPlan } from "@repo/commerce-core/catalog/company";
import type { ProvisioningStore } from "@repo/commerce-core/provisioning/pipeline";
import { Effect, Schema } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  MigrationReferenceLookup,
  SourceIdentity,
  Tracking,
  skipItem,
} from "migrate-sdk";
import type { AnySelfContainedMigrationDefinition } from "migrate-sdk";

import type { CompanyCatalogBindings } from "./b2b";
import type { CatalogClient } from "./destination";
import { variantKey } from "./mapping";
import { trackedId } from "./migrations";
import type { ProjectChannelsMigration } from "./project-setup";

const MarketStock = Schema.Struct({
  productKey: Schema.NonEmptyString,
  supplyChannelKey: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  quantity: Schema.Int,
});
const identity = SourceIdentity.make({
  id: "commercetools-market-stock-key@v1",
  schema: SourceIdentity.key("key", Schema.NonEmptyString),
});
const tracking = Tracking.record({
  id: "commercetools-resource@v1",
  schema: Schema.Struct({ id: Schema.String }),
});

export const makeMarketInventoryMigration = (options: {
  readonly bindings: CompanyCatalogBindings;
  readonly catalog: CatalogName;
  readonly channels: ProjectChannelsMigration;
  readonly client: Effect.Effect<CatalogClient, DestinationError>;
  readonly group: "b2b-companies" | "provision";
  readonly readPlans: Effect.Effect<
    readonly CompanyCatalogPlan[],
    DestinationError
  >;
  readonly products: AnySelfContainedMigrationDefinition;
  readonly store: ProvisioningStore;
}) => {
  const bindings = new Map(
    options.bindings.map((binding) => [binding.assignmentKey, binding])
  );
  const readRows = options.readPlans.pipe(
    Effect.flatMap((plans) =>
      Effect.gen(function* () {
        const stock = new Map<string, typeof MarketStock.Type>();
        for (const { assignment, products } of plans) {
          const binding = bindings.get(assignment.key);
          if (!binding) {
            return yield* new DestinationError({
              message: `Missing inventory binding for ${assignment.key}`,
            });
          }
          const { supplyChannelKey } = binding;
          for (const { key: productKey, variants } of products) {
            for (const { sku, quantity } of variants) {
              stock.set(JSON.stringify([supplyChannelKey, sku]), {
                quantity,
                productKey,
                sku,
                supplyChannelKey,
              });
            }
          }
        }
        return Array.from(stock, ([key, item]) => ({ key, item }));
      })
    )
  );
  return MigrationDefinition.make({
    dependencies: { required: [options.channels.id, options.products.id] },
    execution: { process: { concurrency: 1 } },
    group: options.group,
    id: "commercetools-market-inventory",
    process: Effect.fn("CommercetoolsCatalog.seedMarketInventory")(function* ({
      item: {
        item: { payload: item },
      },
    }) {
      const { productKey, sku, quantity, supplyChannelKey } = item;
      const references = yield* MigrationReferenceLookup;
      const channel = yield* references
        .lookup({
          definition: options.channels,
          sourceIdentityKey: supplyChannelKey,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new DestinationError({
                cause,
                message: `Cannot resolve supply Channel ${supplyChannelKey}`,
              })
          )
        );
      if (channel?.status !== "migrated") {
        return yield* new DestinationError({
          message: `Supply Channel ${supplyChannelKey} has not been provisioned`,
        });
      }
      const { id: supply } = channel.trackingRecord;
      const { apiRoot, write, supplyChannelId } = yield* options.client;
      if (supply === supplyChannelId) {
        return skipItem("Source catalog inventory owns this supply Channel");
      }
      const productId = yield* trackedId(options.products, productKey);
      const { key, masterData } = (yield* Effect.tryPromise({
        try: async () =>
          await apiRoot.products().withId({ ID: productId }).get().execute(),
        catch: (cause) =>
          new DestinationError({
            cause,
            message: `Cannot read tracked Product ${productKey} for market inventory`,
          }),
      })).body;
      const { masterVariant, variants } = masterData.current;
      if (
        key !== productKey ||
        ![masterVariant, ...variants].some(
          (variant) =>
            variant.sku === sku &&
            variant.key === variantKey(options.catalog, sku)
        )
      ) {
        return yield* new DestinationError({
          message: `Tracked Product ${productKey} does not own variant ${sku}`,
        });
      }
      const { results } = (yield* Effect.tryPromise({
        try: async () =>
          await apiRoot
            .inventory()
            .get({
              queryArgs: {
                limit: 2,
                where: `sku=${JSON.stringify(sku)} and supplyChannel(id=${JSON.stringify(supply)})`,
              },
            })
            .execute(),
        catch: (cause) =>
          new DestinationError({
            cause,
            message: `Cannot read inventory for ${sku} in ${supplyChannelKey}`,
          }),
      })).body;
      const [existing] = results;
      if (results.length > 1) {
        return yield* new DestinationError({
          message: `Ambiguous inventory for ${sku} in ${supplyChannelKey}`,
        });
      }
      const entry =
        existing ??
        (yield* write.inventory.create({
          quantityOnStock: quantity,
          sku,
          supplyChannel: { id: supply, typeId: "channel" },
        }));
      yield* Tracking.setRecord({ id: entry.id });
    }),
    source: documentRows(Schema.toType(MarketStock), readRows, identity),
    store: options.store,
    tracking,
  });
};
