import type { Effect as EffectType } from "effect";
import { ConfigProvider, Console, Effect, Layer, Option, Stdio } from "effect";
import { CliError, Command, Flag, Prompt } from "effect/cli";

import { cleanupProjectEntries } from "../project-cleanup/cleanup";
import { cleanupResources, cleanupTargets } from "../project-cleanup/resources";
import type { CleanupResource } from "../project-cleanup/resources";
import { createBootstrapProjectApi } from "../project-provisioning/administration-live";
import { BootstrapCommercetoolsConfig } from "../project-provisioning/bootstrap-config";

const { filter: filterFlag } = Flag;

const whereFlag = Flag.String("where").pipe(
  filterFlag(
    (predicate) => predicate.trim() !== "",
    () => "a non-empty predicate"
  ),
  Flag.optional,
  Flag.withDescription(
    "Native query predicate for a single resource or container"
  )
);

const containerFlag = Flag.String("custom-object-container").pipe(
  filterFlag(
    (key) => key.trim() !== "",
    () => "a non-empty container key"
  ),
  Flag.withDescription(
    "Custom Object container key; repeat to select more containers"
  )
);

export const createCleanupCommand = <E, R>(
  configProvider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>
) => {
  const bootstrap = BootstrapCommercetoolsConfig.layer.pipe(
    Layer.provide(ConfigProvider.layer(configProvider))
  );
  const cleanup = Command.make("cleanup").pipe(
    Command.withDescription("Remove entries from a commercetools project"),
    Command.withSharedFlags({
      batchSize: Flag.Int("batch-size").pipe(
        filterFlag(
          (size) => size >= 1 && size <= 500,
          () => "a page size from 1 to 500"
        ),
        Flag.withDefault(100),
        Flag.withDescription("Page size between 1 and 500")
      ),
      dryRun: Flag.Boolean("dry-run").pipe(
        Flag.atMost(1),
        Flag.map(([enabled]) => enabled ?? false),
        Flag.withDescription(
          "List matching entries without changing the project"
        )
      ),
      limit: Flag.Int("limit").pipe(
        filterFlag(
          (limit) => limit > 0,
          () => "a positive limit"
        ),
        Flag.optional,
        Flag.withDescription(
          "Maximum matching entries per resource or container"
        )
      ),
      yes: Flag.Boolean("yes").pipe(
        Flag.atMost(1),
        Flag.map(([enabled]) => enabled ?? false),
        Flag.withDescription("Skip the deletion confirmation")
      ),
    })
  );

  const run = (
    name: string,
    resources: readonly CleanupResource[],
    containerKeys: readonly string[] = [],
    where?: string
  ) =>
    Effect.gen(function* () {
      const { batchSize, dryRun, limit, yes } = yield* cleanup;
      const needsConfirmation = !dryRun && !yes;
      if (needsConfirmation) {
        const stdio = yield* Stdio.Stdio;
        const inputTty = yield* stdio.stdinIsTerminal;
        const outputTty = yield* stdio.stdoutIsTerminal;
        if (!inputTty || !outputTty) {
          return yield* new CliError.UserError({
            cause: undefined,
            userMessage:
              "Use --yes to confirm deletion without a terminal, or use --dry-run.",
          });
        }
      }

      const config = yield* BootstrapCommercetoolsConfig.pipe(
        Effect.provide(bootstrap)
      );
      const project = `${config.projectKey} (${config.apiUrl})`;
      const containers = [...new Set(containerKeys)];
      if (needsConfirmation) {
        const scope = [
          name,
          ...containers.map(
            (container) => `Custom Objects in ${JSON.stringify(container)}`
          ),
        ]
          .filter(Boolean)
          .join(", ");
        const predicate =
          where === undefined ? "" : ` matching ${JSON.stringify(where)}`;
        const confirmed = yield* Prompt.Confirm({
          initial: false,
          message: `Delete ${scope}${predicate} from ${project}?`,
        });
        if (!confirmed) {
          return yield* Console.log("Cleanup canceled.");
        }
      }

      yield* Console.log(`${dryRun ? "Dry run" : "Cleaning up"} in ${project}`);
      const api = createBootstrapProjectApi(config);
      yield* cleanupProjectEntries(
        cleanupTargets(api, new Set(resources), containers, batchSize),
        {
          batchSize,
          dryRun,
          limit: Option.getOrElse(limit, () => Number.POSITIVE_INFINITY),
          where: where === undefined ? [] : [where],
        }
      ).pipe(
        Effect.mapError(
          (error) =>
            new CliError.UserError({
              cause: undefined,
              userMessage: error.message,
            })
        )
      );
    });

  const all = Command.make(
    "all",
    { containers: containerFlag.pipe(Flag.atLeast(0)) },
    ({ containers }) =>
      run("all supported project resources", cleanupResources, containers)
  ).pipe(
    Command.withDescription(
      "Clean all supported project resources and any named Custom Object containers"
    )
  );

  const customObjects = Command.make(
    "custom-objects",
    { containers: containerFlag.pipe(Flag.atLeast(1)), where: whereFlag },
    ({ containers, where }) =>
      run("", [], containers, Option.getOrUndefined(where))
  ).pipe(
    Command.withDescription("Clean explicitly named Custom Object containers"),
    Command.validate(({ containers, where }) =>
      Option.isSome(where) && new Set(containers).size !== 1
        ? Effect.fail(
            new CliError.ValidationError({
              message: "--where requires exactly one Custom Object container.",
            })
          )
        : Effect.void
    )
  );

  const entities = cleanupResources
    .filter((resource) => resource !== "custom-objects")
    .map((resource) =>
      Command.make(resource, { where: whereFlag }, ({ where }) =>
        run(resource, [resource], [], Option.getOrUndefined(where))
      ).pipe(Command.withDescription(`Clean ${resource}`))
    );

  return cleanup.pipe(
    Command.withSubcommands([all, customObjects, ...entities])
  );
};
