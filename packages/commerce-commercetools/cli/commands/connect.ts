/* oxlint-disable anti-slop-effect/no-service-constructor-imports -- The provider CLI composes its Connect administration layer. */
import { renderReport, withCommandOutput } from "@repo/cli-core/command-output";
import { ConfigProvider, Console, Effect, Layer } from "effect";
import { CliError, Command, Flag, Prompt } from "effect/cli";

import {
  connectAdministrationLayer,
  connectHttpClientLayer,
} from "../connect/client";
import { deployConnectProxy } from "../connect/deploy";
import { connectDeploymentReport } from "../connect/output";
import { BootstrapCommercetoolsConfig } from "../project-provisioning/bootstrap-config";

export const createConnectCommand = <E, R>(
  provider: Effect.Effect<ConfigProvider.ConfigProvider, E, R>
) => {
  const bootstrap = BootstrapCommercetoolsConfig.layer.pipe(
    Layer.provide(ConfigProvider.layer(provider))
  );
  const administration = connectAdministrationLayer.pipe(
    Layer.provide(connectHttpClientLayer()),
    Layer.provideMerge(bootstrap)
  );
  const deploy = Command.make(
    "deploy",
    {
      connectorKey: Flag.String("connector-key").pipe(
        Flag.withDescription("Published Connect Proxy connector key")
      ),
      connectorVersion: Flag.Int("connector-version").pipe(
        Flag.withDescription(
          "Expected Connector version. New deployments and upgrades use the latest published version."
        )
      ),
      deploymentKey: Flag.String("deployment-key").pipe(
        Flag.withDescription("Unique deployment key and Subscription suffix")
      ),
      dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
      endpoint: Flag.String("endpoint").pipe(
        Flag.withDescription(
          "Full public HTTPS API receiver URL, including its path"
        )
      ),
      redeploy: Flag.Boolean("redeploy").pipe(
        Flag.withDescription(
          "Update or retry an existing installation using its original deployment key"
        ),
        Flag.withDefault(false)
      ),
      timeoutSeconds: Flag.Int("timeout").pipe(
        Flag.withDescription("Maximum deployment wait in seconds"),
        Flag.withDefault(900)
      ),
      type: Flag.Literals("type", ["sandbox", "production"]).pipe(
        Flag.withDefault("sandbox")
      ),
      yes: Flag.Boolean("yes").pipe(Flag.withDefault(false)),
    },
    ({
      connectorKey,
      connectorVersion,
      deploymentKey,
      dryRun,
      endpoint,
      redeploy,
      timeoutSeconds,
      type,
      yes,
    }) =>
      withCommandOutput(
        {
          context: "commercetools Connect",
          failureNote:
            "Review the error below. If Connect accepted the deployment, it may keep building. Rerun the same command without --redeploy to check its state and resume waiting.",
          title: "Deploy commerce event proxy",
        },
        (style) =>
          Effect.gen(function* () {
            if (!dryRun && !yes) {
              const confirmed = yield* Prompt.Confirm({
                initial: false,
                message: `Deploy ${connectorKey} version ${connectorVersion} as ${deploymentKey}? Connect will generate the proxy's API credentials.`,
              });
              if (!confirmed) {
                return yield* new CliError.UserError({
                  cause: undefined,
                  userMessage: "Connect deployment cancelled.",
                });
              }
            }
            const environment = yield* provider;
            const receipt = yield* deployConnectProxy(
              {
                connectorKey,
                connectorVersion,
                deploymentKey,
                dryRun,
                endpoint,
                redeploy,
                timeoutSeconds,
                type,
              },
              environment
            ).pipe(
              Effect.mapError(
                (error) =>
                  new CliError.UserError({
                    cause: undefined,
                    userMessage: error.message,
                  })
              )
            );
            yield* Console.log(
              renderReport(connectDeploymentReport(receipt), style)
            );
          })
      )
  ).pipe(
    Command.withDescription(
      "Deploy a published Connect Proxy for the installed commerce event consumers"
    ),
    Command.provide(administration)
  );
  return Command.make("connect", {}, () => Effect.void).pipe(
    Command.withDescription("Commercetools Connect deployment commands"),
    Command.withSubcommands([deploy])
  );
};
