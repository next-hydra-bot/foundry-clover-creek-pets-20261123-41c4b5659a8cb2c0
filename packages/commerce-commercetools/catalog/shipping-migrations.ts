import type { ByProjectKeyRequestBuilder } from "@commercetools/platform-sdk";
import {
  documentRows,
  ProvisionedResource,
} from "@repo/cli-core/json-migrations";
import type { ProvisioningStore } from "@repo/commerce-core/provisioning/pipeline";
import {
  ShippingService,
  ShippingZone,
} from "@repo/commerce-core/provisioning/shipping";
import type { ShippingSetup } from "@repo/commerce-core/provisioning/shipping";
import { Effect, Schema } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  MigrationReferenceLookup,
  Tracking,
} from "migrate-sdk";

import { recordCatalogChange } from "./journal";

const request = <A>(message: string, run: () => Promise<{ body: A }>) =>
  Effect.tryPromise({
    catch: (cause) => new DestinationError({ cause, message }),
    try: async () => {
      const { body } = await run();
      return body;
    },
  });

const tracking = Tracking.record({
  id: "domain-resource@v1",
  schema: ProvisionedResource,
});

export const makeShippingMigrations = ({
  client,
  read,
  store,
  taxCategoryKey,
}: {
  readonly client: Effect.Effect<ByProjectKeyRequestBuilder, DestinationError>;
  readonly read: Effect.Effect<
    ShippingSetup,
    DestinationError | Schema.SchemaError
  >;
  readonly store: ProvisioningStore;
  readonly taxCategoryKey: string;
}) => {
  const zones = MigrationDefinition.make({
    group: "project-setup",
    id: "commercetools-shipping-zones",
    process: ({ item }, { previousState }) =>
      Effect.gen(function* () {
        const { key, countries } = item.item.payload;
        if (previousState?.trackingRecord) {
          return yield* new DestinationError({
            message: `Shipping Zone ${key} already has a tracking record. This migration only creates Zones.`,
          });
        }
        const api = yield* client;
        const zone = yield* request(
          `Create Shipping Zone ${key}`,
          async () =>
            await api
              .zones()
              .post({
                body: {
                  key,
                  locations: countries.map((country) => ({ country })),
                  name: key,
                },
              })
              .execute()
        );
        yield* recordCatalogChange("zone.create", zone);
        yield* Tracking.setRecord({ id: zone.id, key });
      }),
    source: documentRows(
      Schema.toType(ShippingZone),
      read.pipe(
        Effect.map(({ zones: zoneItems }) =>
          zoneItems.map((item) => ({
            inputs: "shipping-zone-v1",
            item,
            key: item.key,
          }))
        )
      )
    ),
    store,
    tracking,
  });

  const services = MigrationDefinition.make({
    dependencies: { required: [zones.id] },
    group: "project-setup",
    id: "commercetools-shipping-methods",
    process: ({ item }, { previousState }) =>
      Effect.gen(function* () {
        const { key, name, rates } = item.item.payload;
        if (previousState?.trackingRecord) {
          return yield* new DestinationError({
            message: `Shipping Method ${key} already has a tracking record. This migration only creates Shipping Methods.`,
          });
        }
        const references = yield* MigrationReferenceLookup;
        const zoneRates = yield* Effect.forEach(
          ({ zoneKey, price }: ShippingService["rates"][number]) =>
            Effect.gen(function* () {
              const zone = yield* references.lookup({
                definition: zones,
                sourceIdentityKey: zoneKey,
              });
              if (zone?.status !== "migrated") {
                return yield* new DestinationError({
                  message: `Shipping Zone ${zoneKey} has no successful tracking record`,
                });
              }
              return {
                shippingRates: [{ price }],
                zone: { id: zone.trackingRecord.id, typeId: "zone" as const },
              };
            })
        )(rates);
        const api = yield* client;
        const method = yield* request(
          `Create Shipping Method ${key}`,
          async () =>
            await api
              .shippingMethods()
              .post({
                body: {
                  active: true,
                  isDefault: false,
                  key,
                  name,
                  taxCategory: { key: taxCategoryKey, typeId: "tax-category" },
                  zoneRates,
                },
              })
              .execute()
        );
        yield* recordCatalogChange("shipping-method.create", method);
        yield* Tracking.setRecord({ id: method.id, key });
      }),
    source: documentRows(
      Schema.toType(ShippingService),
      read.pipe(
        Effect.map(({ services: serviceItems }) =>
          serviceItems.map((item) => ({
            inputs: ["shipping-method-v1", taxCategoryKey],
            item,
            key: item.key,
          }))
        )
      )
    ),
    store,
    tracking,
  });
  return [zones, services] as const;
};
