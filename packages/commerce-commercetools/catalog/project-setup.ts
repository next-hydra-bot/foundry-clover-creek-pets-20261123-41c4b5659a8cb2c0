import type {
  ByProjectKeyRequestBuilder,
  Store,
} from "@commercetools/platform-sdk";
import {
  makeJsonMigration,
  ProvisionedResource,
} from "@repo/cli-core/json-migrations";
import type { CompanyCatalogPlan } from "@repo/commerce-core/catalog/company";
import type { SellingCatalog } from "@repo/commerce-core/catalog/selling";
import type { ProvisioningStore } from "@repo/commerce-core/provisioning/pipeline";
import { Array as EffectArray, Effect, Order, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import type { CompanyCatalogBindings } from "./b2b";
import type { CatalogSdk } from "./destination";
import { recordCatalogChange } from "./journal";

const ChannelRole = Schema.Literals(["ProductDistribution", "InventorySupply"]);
type ChannelRole = typeof ChannelRole.Type;
const ChannelSetup = Schema.Struct({
  key: Schema.NonEmptyString,
  roles: Schema.Array(ChannelRole),
});
const StoreSetup = Schema.Struct({
  key: Schema.NonEmptyString,
  names: Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString),
  distributionChannelKey: Schema.NonEmptyString,
  supplyChannelKey: Schema.NonEmptyString,
});

const request = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      new DestinationError({
        cause,
        message: `Commercetools project setup could not ${operation}`,
      }),
    try: run,
  });

const whereKey = (key: string) => `key=${JSON.stringify(key)}`;

export const findProjectChannel = (
  api: ByProjectKeyRequestBuilder,
  key: string,
  roles: readonly ChannelRole[]
) =>
  Effect.gen(function* () {
    const { results } = (yield* request(
      `read Channel ${key}`,
      async () =>
        await api
          .channels()
          .get({ queryArgs: { limit: 2, where: whereKey(key) } })
          .execute()
    )).body;
    const [channel] = results;
    if (
      results.length > 1 ||
      (channel && !roles.every((role) => channel.roles.includes(role)))
    ) {
      return yield* new DestinationError({
        message: `Channel ${key} has ambiguous identity or incompatible roles`,
      });
    }
    return channel;
  });

export const findProjectStore = (
  api: ByProjectKeyRequestBuilder,
  key: string
) =>
  Effect.gen(function* () {
    const { results } = (yield* request(
      `read Store ${key}`,
      async () =>
        await api
          .stores()
          .get({ queryArgs: { limit: 2, where: whereKey(key) } })
          .execute()
    )).body;
    if (results.length > 1) {
      return yield* new DestinationError({
        message: `Ambiguous native Store ${key}`,
      });
    }
    return results[0];
  });

export const storeUsesChannels = (
  store: Store,
  distributionId: string,
  supplyId: string
) =>
  store.distributionChannels.length === 1 &&
  store.distributionChannels[0]?.id === distributionId &&
  store.supplyChannels.length === 1 &&
  store.supplyChannels[0]?.id === supplyId;

export const makeProjectSetupMigrations = (options: {
  readonly bindings: CompanyCatalogBindings;
  readonly client: Effect.Effect<CatalogSdk, DestinationError>;
  readonly readSetup: Effect.Effect<
    {
      readonly plans: readonly CompanyCatalogPlan[];
      readonly stores: SellingCatalog["stores"];
    },
    DestinationError
  >;
  readonly store: ProvisioningStore;
}) =>
  Effect.gen(function* () {
    const bindings = new Map(
      options.bindings.map((binding) => [binding.assignmentKey, binding])
    );
    const readRows = options.readSetup.pipe(
      Effect.flatMap(({ plans, stores }) =>
        Effect.gen(function* () {
          const storesByKey = new Map<string, typeof StoreSetup.Type>();
          const rolesByChannel = new Map<string, Set<ChannelRole>>();
          for (const plan of plans) {
            const binding = bindings.get(plan.assignment.key);
            if (!binding) {
              return yield* new DestinationError({
                message: `Missing project setup binding for ${plan.assignment.key}`,
              });
            }
            const { distributionChannelKey, supplyChannelKey } = binding;
            storesByKey.set(plan.store.storeKey, {
              key: plan.store.storeKey,
              names: Object.fromEntries(
                EffectArray.sortWith(
                  stores.filter(
                    ({ storeKey }) => storeKey === plan.store.storeKey
                  ),
                  ({ locale }) => locale,
                  Order.String
                ).map(({ locale, displayName, storeKey }) => [
                  locale,
                  displayName ?? storeKey,
                ])
              ),
              distributionChannelKey,
              supplyChannelKey,
            });
            const channels = [
              [distributionChannelKey, "ProductDistribution"],
              [supplyChannelKey, "InventorySupply"],
            ] as const;
            for (const [key, role] of channels) {
              const roles = rolesByChannel.get(key) ?? new Set<ChannelRole>();
              roles.add(role);
              rolesByChannel.set(key, roles);
            }
          }
          return { storesByKey, rolesByChannel };
        })
      )
    );
    const channels = yield* makeJsonMigration({
      destination: {
        entity: ProvisionedResource,
        reference: (channel) => channel,
        write: (input) =>
          Effect.gen(function* () {
            const { apiRoot } = yield* options.client;
            const current = yield* findProjectChannel(
              apiRoot,
              input.key,
              input.roles
            );
            if (current) {
              return { id: current.id, key: current.key };
            }
            const channel = (yield* request(
              `create Channel ${input.key}`,
              async () =>
                await apiRoot
                  .channels()
                  .post({ body: { key: input.key, roles: [...input.roles] } })
                  .execute()
            )).body;
            yield* recordCatalogChange("channel.create", channel);
            return { id: channel.id, key: channel.key };
          }),
      },
      group: "project-setup",
      id: "commercetools-channels",
      input: {
        read: readRows.pipe(
          Effect.map(({ rolesByChannel }) =>
            Array.from(rolesByChannel, ([key, roles]) => ({
              key,
              roles: [...roles],
            }))
          )
        ),
        key: (item) => item.key,
        schema: ChannelSetup,
      },
      revision: "commercetools-channels-v1",
      store: options.store,
    });
    const stores = yield* makeJsonMigration({
      dependencies: [channels],
      destination: {
        entity: ProvisionedResource,
        reference: (store) => store,
        write: (input, references) =>
          Effect.gen(function* () {
            const distribution = yield* references.get(
              channels,
              input.distributionChannelKey
            );
            const supply = yield* references.get(
              channels,
              input.supplyChannelKey
            );
            const { apiRoot, write } = yield* options.client;
            const current = yield* findProjectStore(apiRoot, input.key);
            const declaredLanguages = Object.keys(input.names);
            const distributionChannels = [
              { id: distribution.id, typeId: "channel" as const },
            ];
            const supplyChannels = [
              { id: supply.id, typeId: "channel" as const },
            ];
            if (!current) {
              const store = yield* write.stores.create({
                key: input.key,
                name: input.names,
                languages: declaredLanguages,
                distributionChannels,
                supplyChannels,
              });
              return { id: store.id, key: store.key };
            }
            if (storeUsesChannels(current, distribution.id, supply.id)) {
              const languages = new Set(current.languages);
              const name = { ...current.name, ...input.names };
              if (
                declaredLanguages.some(
                  (locale) =>
                    !languages.has(locale) ||
                    current.name?.[locale] !== input.names[locale]
                )
              ) {
                yield* write.stores.update({
                  actions: [
                    {
                      action: "setLanguages",
                      languages: [
                        ...new Set([...languages, ...declaredLanguages]),
                      ],
                    },
                    { action: "setName", name },
                  ],
                  selector: { kind: "key", key: input.key },
                  version: current.version,
                });
              }
              return { id: current.id, key: current.key };
            }
            return yield* new DestinationError({
              message: `Existing Store ${input.key} does not match its declared distribution and supply channels`,
            });
          }).pipe(
            Effect.catchTag("SchemaError", (cause) =>
              Effect.fail(
                new DestinationError({
                  cause,
                  message: `Invalid Store setup for ${input.key}`,
                })
              )
            )
          ),
      },
      group: "project-setup",
      id: "commercetools-stores",
      input: {
        read: readRows.pipe(
          Effect.map(({ storesByKey }) => [...storesByKey.values()])
        ),
        key: (item) => item.key,
        schema: StoreSetup,
      },
      revision: "commercetools-stores-v2",
      store: options.store,
    });
    return { channels, definitions: [channels, stores], stores };
  });

export type ProjectChannelsMigration = Effect.Success<
  ReturnType<typeof makeProjectSetupMigrations>
>["channels"];
