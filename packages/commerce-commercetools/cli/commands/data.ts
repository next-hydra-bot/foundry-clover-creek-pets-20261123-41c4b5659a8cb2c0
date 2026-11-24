import { authInputModels } from "@repo/auth-contract/provisioning/input-models";
import {
  makeJsonProvisionCommand,
  makeJsonSchemaCommand,
} from "@repo/cli-core/json-migration-command";
import { CustomerInput } from "@repo/commerce-core/domain/customer";
import { commerceInputModels } from "@repo/commerce-core/provisioning/input-models";
import { makeSetupCommand } from "@repo/commerce-core/provisioning/pipeline";
import { Config, ConfigProvider, Effect } from "effect";
import type { Effect as EffectType } from "effect";
import { Command } from "effect/cli";
import { DestinationError } from "migrate-sdk";

import { createCommercetoolsApiRoot } from "../../client/rest-client-live";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The provider CLI is the migration composition root.
import { makeCustomerDestination } from "../../provisioning/customers";
import { prepareB2CProfile } from "../../provisioning/profile";

export const createDataCommand = <E, R>(
  configProvider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>
) => {
  const prepare = Effect.gen(function* () {
    const provider = yield* configProvider;
    const target = yield* Config.all({
      projectKey: Config.String("COMMERCETOOLS_PROJECT_KEY"),
      region: Config.String("COMMERCETOOLS_REGION"),
    }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider));
    const client = yield* Effect.cached(
      Config.all({
        clientId: Config.String("COMMERCETOOLS_CLIENT_ID"),
        clientSecret: Config.Redacted("COMMERCETOOLS_CLIENT_SECRET"),
        scope: Config.String("COMMERCETOOLS_SCOPE"),
      }).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, provider),
        Effect.map((configuration) =>
          createCommercetoolsApiRoot(
            { ...configuration, ...target },
            { enableRetry: false }
          ).withProjectKey({ projectKey: target.projectKey })
        ),
        Effect.mapError(
          () =>
            new DestinationError({
              message:
                "Configure Commercetools customer provisioning credentials.",
            })
        )
      )
    );
    return {
      destination: makeCustomerDestination(client),
      target: `${target.region}/${target.projectKey}`,
    };
  });
  return Command.make("data", {}, () => Effect.void).pipe(
    Command.withSubcommands([
      makeJsonSchemaCommand({ ...commerceInputModels, ...authInputModels }),
      makeSetupCommand(configProvider, prepareB2CProfile),
      makeJsonProvisionCommand({
        id: "customers",
        key: (input: typeof CustomerInput.Type) => input.key,
        prepare,
        revision: "commercetools-customers-v1",
        schema: CustomerInput,
      }),
    ])
  );
};
