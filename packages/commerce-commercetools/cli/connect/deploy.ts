import { note, phase } from "@repo/cli-core/command-output";
import {
  Clock,
  Config,
  ConfigProvider,
  Effect,
  Redacted,
  Schema,
} from "effect";

import { commerceEventSubscription } from "../../webhooks/subscription";
import { BootstrapCommercetoolsConfig } from "../project-provisioning/bootstrap-config";
import {
  ConnectAdministration,
  ConnectDeploymentError,
  ConnectKey,
  Subscription,
  connectFailure,
} from "./model";
import type {
  ConnectDeploymentReceipt,
  Deployment,
  ProxyConfiguration,
} from "./model";
import { connectSteps } from "./output";

export interface DeployConnectOptions {
  readonly connectorKey: string;
  readonly connectorVersion: number;
  readonly deploymentKey: string;
  readonly endpoint: string;
  readonly type: "sandbox" | "production";
  readonly dryRun: boolean;
  readonly redeploy: boolean;
  readonly timeoutSeconds: number;
}

const validateOptions = (options: DeployConnectOptions) =>
  Effect.gen(function* () {
    yield* Schema.decodeEffect(ConnectKey)(options.connectorKey);
    yield* Schema.decodeEffect(ConnectKey)(options.deploymentKey);
    const endpoint = URL.parse(options.endpoint);
    if (
      endpoint?.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname === "/"
    ) {
      return yield* connectFailure(
        "configuration",
        "--endpoint must be a full HTTPS receiver URL including its path, without credentials, query or fragment."
      );
    }
    if (
      !Number.isInteger(options.connectorVersion) ||
      options.connectorVersion < 1 ||
      !Number.isInteger(options.timeoutSeconds) ||
      options.timeoutSeconds < 1 ||
      options.timeoutSeconds > 3600
    ) {
      return yield* connectFailure(
        "configuration",
        "Connector version must be a positive integer; timeout must be between 1 and 3600 seconds."
      );
    }
    return endpoint.href;
  });

const managesSubscriptions = (scopes: readonly string[], projectKey: string) =>
  scopes.includes("manage_subscriptions") ||
  scopes.includes(`manage_subscriptions:${projectKey}`);

const eventConfiguration = (deployment: Deployment | null) =>
  deployment?.applications.find(
    ({ applicationName }) => applicationName === "event"
  )?.standardConfiguration;

const forwardingHeaders = (deployment: Deployment | null) =>
  (eventConfiguration(deployment) ?? []).filter(
    ({ key }) => key === "ADDITIONAL_HEADERS"
  );

const standardMatches = (
  deployment: Deployment,
  desired: ProxyConfiguration
) => {
  const configuration = eventConfiguration(deployment);
  if (deployment.applications.length !== 1 || configuration === undefined) {
    return false;
  }
  const current = new Map(configuration.map(({ key, value }) => [key, value]));
  return desired.standardConfiguration.every(
    ({ key, value }) => current.get(key) === value
  );
};

const assertTarget = (
  existing: Deployment,
  options: DeployConnectOptions,
  region: string
) =>
  existing.connector.key === options.connectorKey &&
  existing.deployedRegion === region &&
  existing.type === options.type
    ? Effect.void
    : connectFailure(
        "configuration",
        "This deployment belongs to another Connector, region or deployment type. Check --deployment-key or choose a new key."
      );

const changeKeyInstructions =
  "To use a different key, uninstall the existing app in Merchant Center > Connect > Installations, wait for removal to finish, then deploy with the new key without --redeploy.";

const assertSubscriptionKey = (
  existing: Deployment | null,
  options: DeployConnectOptions
) => {
  if (existing === null) {
    return options.redeploy
      ? connectFailure(
          "configuration",
          `No installation found for --deployment-key ${options.deploymentKey}. Redeploy requires the existing deployment key. ${changeKeyInstructions}`
        )
      : Effect.void;
  }

  const installedSuffix = eventConfiguration(existing)?.find(
    ({ key }) => key === "SUBSCRIPTION_SUFFIX"
  )?.value;
  if (installedSuffix === undefined) {
    return options.redeploy
      ? connectFailure(
          "configuration",
          "Could not verify the installed subscription key. Check SUBSCRIPTION_SUFFIX in Connect before retrying."
        )
      : Effect.void;
  }
  return installedSuffix === options.deploymentKey
    ? Effect.void
    : connectFailure(
        "configuration",
        `The installed SUBSCRIPTION_SUFFIX differs from --deployment-key ${options.deploymentKey}. Redeploy cannot change the subscription key. ${changeKeyInstructions}`
      );
};

const checkPublishedConnector = Effect.fn("Connect.checkPublishedConnector")(
  function* (options: DeployConnectOptions, projectKey: string) {
    const api = yield* ConnectAdministration;
    const connector = yield* api.getConnector(options.connectorKey);
    if (connector.version !== options.connectorVersion) {
      return yield* connectFailure(
        "configuration",
        `Connector ${options.connectorKey} is currently published at version ${connector.version}; requested ${options.connectorVersion}. Use the published version. Connect upgrades only to the latest published Connector.`
      );
    }
    if (!managesSubscriptions(connector.apiClient?.scopes ?? [], projectKey)) {
      return yield* connectFailure(
        "configuration",
        `Connector ${options.connectorKey} version ${options.connectorVersion} does not declare Connect-managed credentials with manage_subscriptions. Publish the updated proxy Connector before deploying this version.`
      );
    }
  }
);

export const waitForConnectDeployment = Effect.fn("Connect.waitForDeployment")(
  (initial: Deployment, timeoutSeconds: number) =>
    Effect.gen(function* () {
      const api = yield* ConnectAdministration;
      const startedAt = yield* Clock.currentTimeMillis;
      let deployment = initial;
      while (deployment.status !== "Deployed") {
        if (
          ["Failed", "UndeployFailed", "Undeploying"].includes(
            deployment.status
          )
        ) {
          return yield* connectFailure(
            "deployment",
            `Deployment ${initial.key} is ${deployment.status}. Check its build logs in Merchant Center > Connect > Installations, then retry with --redeploy.`
          );
        }
        const elapsed = Math.floor(
          ((yield* Clock.currentTimeMillis) - startedAt) / 1000
        );
        yield* note(
          `${initial.key}: ${deployment.status} · ${elapsed}s elapsed · timeout ${timeoutSeconds}s`
        );
        yield* Effect.sleep("3 seconds");
        const current = yield* api.getDeployment(initial.key);
        if (current === null || current.id !== initial.id) {
          return yield* connectFailure(
            "deployment",
            "The deployment disappeared or was replaced while waiting. Check its state in Connect before retrying."
          );
        }
        deployment = current;
      }
      return deployment;
    }).pipe(
      Effect.timeout(`${timeoutSeconds} seconds`),
      Effect.catchTag("TimeoutError", () =>
        connectFailure(
          "timeout",
          `Timed out waiting for ${initial.key}. Connect may still be building it. Rerun the same command without --redeploy to check and resume waiting.`
        )
      )
    )
);

export const deployConnectProxy = Effect.fn("Connect.deployProxy")(
  function* (
    options: DeployConnectOptions,
    environment: ConfigProvider.ConfigProvider
  ) {
    const endpoint = yield* validateOptions(options);
    const config = yield* BootstrapCommercetoolsConfig;
    const api = yield* ConnectAdministration;
    const managesProject = config.scopes.includes(
      `manage_project:${config.projectKey}`
    );
    for (const scope of [
      "manage_connectors_deployments",
      "manage_subscriptions",
    ]) {
      if (
        !managesProject &&
        !config.scopes.includes(`${scope}:${config.projectKey}`)
      ) {
        return yield* connectFailure(
          "permissions",
          `The management API Client needs ${scope}:${config.projectKey}. Add the grant to the client and include its granted scopes in CTP_SCOPES.`
        );
      }
    }
    const webhookSecret = yield* Config.schema(
      Schema.RedactedFromValue(Schema.NonEmptyString),
      "COMMERCETOOLS_WEBHOOK_SECRET"
    ).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, environment),
      Effect.mapError(() =>
        connectFailure(
          "configuration",
          "Set COMMERCETOOLS_WEBHOOK_SECRET in --env-file to the same value configured in the receiving API app."
        )
      )
    );
    const existing = yield* phase(
      connectSteps.inspect,
      api.getDeployment(options.deploymentKey)
    );
    if (existing) {
      yield* assertTarget(existing, options, config.region);
    }
    yield* assertSubscriptionKey(existing, options);
    const upgrade =
      existing !== null &&
      existing.connector.version !== options.connectorVersion;
    const pending =
      existing !== null && ["Queued", "Deploying"].includes(existing.status);
    if (
      existing === null ||
      upgrade ||
      (!pending &&
        !managesSubscriptions(
          existing.apiClient?.scopes ?? [],
          config.projectKey
        ))
    ) {
      yield* phase(
        connectSteps.connector,
        checkPublishedConnector(options, config.projectKey)
      );
    }
    const subscriptionConfig = yield* Schema.encodeEffect(
      Schema.fromJsonString(Subscription)
    )(commerceEventSubscription);
    const configuration: ProxyConfiguration = {
      applicationName: "event",
      securedConfiguration: [
        { key: "WEBHOOK_SECRET", value: Redacted.value(webhookSecret) },
      ],
      standardConfiguration: [
        { key: "API_ENDPOINT", value: endpoint },
        { key: "SUBSCRIPTION_SUFFIX", value: options.deploymentKey },
        {
          key: "SUBSCRIPTION_CONFIG",
          value: subscriptionConfig,
        },
        ...forwardingHeaders(existing),
      ],
    };
    if (existing?.status === "Undeploying") {
      return yield* connectFailure(
        "deployment",
        "The deployment is being removed. Wait for removal to finish before retrying."
      );
    }
    if (
      pending &&
      (options.redeploy || upgrade || !standardMatches(existing, configuration))
    ) {
      return yield* connectFailure(
        "deployment",
        "A deployment is already in progress. Wait for it to finish, or rerun its original command without --redeploy to resume waiting."
      );
    }
    if (
      existing !== null &&
      !pending &&
      !options.redeploy &&
      (upgrade ||
        existing.status !== "Deployed" ||
        !standardMatches(existing, configuration))
    ) {
      return yield* connectFailure(
        "configuration",
        "The deployment needs an upgrade, configuration update or retry. Rerun with --redeploy to apply the requested Connector, endpoint and event selection."
      );
    }
    if (
      (existing === null || options.redeploy) &&
      !config.scopes.includes(`manage_api_clients:${config.projectKey}`)
    ) {
      return yield* connectFailure(
        "permissions",
        `Connect-managed credentials require manage_api_clients:${config.projectKey} on the management API Client. Include this granted scope in CTP_SCOPES.`
      );
    }
    const receipt = {
      connectorKey: options.connectorKey,
      connectorVersion: options.connectorVersion,
      deploymentKey: options.deploymentKey,
      endpoint,
      projectKey: config.projectKey,
    };
    if (options.dryRun) {
      let plannedAction: ConnectDeploymentReceipt["action"] = "would-reuse";
      if (existing === null) {
        plannedAction = "would-create";
      } else if (options.redeploy) {
        plannedAction = "would-redeploy";
      }
      return {
        ...receipt,
        action: plannedAction,
        status: existing?.status ?? "NotCreated",
        subscriptionVerified: false,
      } satisfies ConnectDeploymentReceipt;
    }
    let deployment = existing;
    let action: ConnectDeploymentReceipt["action"] = "reused";
    if (deployment === null) {
      deployment = yield* phase(
        connectSteps.create,
        api.createDeployment({
          configurations: [configuration],
          connector: {
            key: options.connectorKey,
            version: options.connectorVersion,
          },
          key: options.deploymentKey,
          region: config.region,
          type: options.type,
        })
      );
      action = "created";
    } else if (options.redeploy) {
      deployment = yield* phase(
        connectSteps.redeploy,
        api.redeploy(deployment, [configuration], upgrade)
      );
      action = "redeployed";
    }
    deployment = yield* phase(
      connectSteps.wait,
      waitForConnectDeployment(deployment, options.timeoutSeconds)
    );
    yield* assertTarget(deployment, options, config.region);
    if (
      deployment.connector.version !== options.connectorVersion ||
      !managesSubscriptions(
        deployment.apiClient?.scopes ?? [],
        config.projectKey
      ) ||
      !standardMatches(deployment, configuration)
    ) {
      return yield* connectFailure(
        "configuration",
        "Connect finished with a different Connector, credential configuration or event selection. Inspect the installation before retrying."
      );
    }
    const subscription = yield* phase(
      connectSteps.subscription,
      api.verifySubscription(deployment, commerceEventSubscription)
    );
    return {
      ...receipt,
      action,
      status: "Deployed",
      subscription,
      subscriptionVerified: true,
    } satisfies ConnectDeploymentReceipt;
  },
  Effect.mapError((error) =>
    Schema.is(ConnectDeploymentError)(error)
      ? error
      : connectFailure(
          "deployment",
          "Connect setup could not be confirmed. Check the management credentials in --env-file and the installation logs in Connect. Secrets are not printed."
        )
  )
);
