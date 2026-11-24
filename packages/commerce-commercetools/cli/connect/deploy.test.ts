import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { CommandProgress } from "@repo/cli-core/command-output";
import { ConfigProvider, Effect, Fiber, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { BootstrapCommercetoolsConfig } from "../project-provisioning/bootstrap-config";
import {
  ApiClientId,
  CommercetoolsRegion,
  ProjectKey,
} from "../project-provisioning/model";
import { connectAdministrationLayer, connectHttpClientLayer } from "./client";
import { deployConnectProxy, waitForConnectDeployment } from "./deploy";
import type { DeployConnectOptions } from "./deploy";
import { Subscription } from "./model";
import type { Connector, Deployment, VerifiedSubscription } from "./model";
import { connectDeploymentReport } from "./output";

const Values = Schema.Array(
  Schema.Struct({ key: Schema.String, value: Schema.String })
);
const Configurations = Schema.Array(
  Schema.Struct({
    applicationName: Schema.String,
    securedConfiguration: Values,
    standardConfiguration: Values,
  })
);
const Draft = Schema.Struct({
  configurations: Configurations,
  connector: Schema.Struct({ key: Schema.String, version: Schema.Int }),
  key: Schema.String,
  region: Schema.String,
  type: Schema.Literals(["sandbox", "production"]),
});
const Redeploy = Schema.Struct({
  actions: Schema.Array(
    Schema.Struct({
      configurationValues: Configurations,
      skipScripts: Schema.Boolean,
      updateConnector: Schema.Boolean,
    })
  ),
});
const bootstrap = BootstrapCommercetoolsConfig.of({
  apiUrl: "https://api.us-central1.gcp.commercetools.com",
  authUrl: "https://auth.us-central1.gcp.commercetools.com",
  clientId: ApiClientId.make("bootstrap-client"),
  clientSecret: Redacted.make("bootstrap-secret"),
  projectKey: ProjectKey.make("test-project"),
  region: CommercetoolsRegion.make("us-central1.gcp"),
  scopes: [
    "manage_connectors_deployments:test-project",
    "view_connectors:test-project",
    "manage_api_clients:test-project",
    "manage_subscriptions:test-project",
  ],
});
const managedClient = { scopes: ["manage_subscriptions:test-project"] };
const defaultEnvironment = {
  COMMERCETOOLS_WEBHOOK_SECRET: "receiver-secret",
};
const deployedTopic = {
  projectId: "connect-project",
  topic: "event-topic",
  type: "GoogleCloudPubSub",
};
const topicPath = `projects/${deployedTopic.projectId}/topics/${deployedTopic.topic}`;

const fixture = Effect.sync(() => {
  const requests: {
    readonly method: string;
    readonly path: string;
    readonly body: string;
  }[] = [];
  let deployment: Deployment | null = null;
  let connector: Connector = {
    apiClient: { scopes: ["manage_subscriptions"] },
    key: "event-proxy",
    version: 7,
  };
  let configurations: typeof Configurations.Type = [];
  let appTopic: string | undefined = topicPath;
  let subscriptionDestination = deployedTopic;
  let subscriptionHealth: VerifiedSubscription["health"] = "Healthy";
  let subscriptionMissing = false;
  let loseCreateResponse = false;
  const fetchApi: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = await request.text();
    requests.push({ body, method: request.method, path: url.pathname });
    if (url.pathname === "/oauth/token") {
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }
    if (url.pathname.startsWith("/connectors/key=")) {
      return Response.json(connector);
    }
    if (url.pathname.includes("/subscriptions/")) {
      if (subscriptionMissing) {
        return Response.json({}, { status: 404 });
      }
      const encoded =
        configurations[0]?.standardConfiguration.find(
          ({ key }) => key === "SUBSCRIPTION_CONFIG"
        )?.value ?? "{}";
      const decoded = Schema.decodeSync(Schema.fromJsonString(Subscription))(
        encoded
      );
      return Response.json({
        changes: decoded.changes.length > 0 ? decoded.changes : undefined,
        destination: subscriptionDestination,
        messages: decoded.messages.length > 0 ? decoded.messages : undefined,
        status: subscriptionHealth,
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/deployments")) {
      const draft = Schema.decodeSync(Schema.fromJsonString(Draft))(body);
      ({ configurations } = draft);
      deployment = {
        apiClient: managedClient,
        applications: configurations.map((value) => ({
          ...value,
          topic: appTopic,
        })),
        connector: draft.connector,
        deployedRegion: draft.region,
        id: "deployment-1",
        key: draft.key,
        status: "Deployed",
        type: draft.type,
        version: 1,
      };
      return loseCreateResponse
        ? Response.json({ message: "private-provider-secret" }, { status: 500 })
        : Response.json(deployment);
    }
    if (request.method === "POST" && deployment !== null) {
      const [action] = Schema.decodeSync(Schema.fromJsonString(Redeploy))(
        body
      ).actions;
      if (!action) {
        throw new Error("Expected a redeploy action");
      }
      configurations = action.configurationValues;
      deployment = {
        ...deployment,
        apiClient: managedClient,
        applications: configurations.map((value) => ({
          ...value,
          topic: appTopic,
        })),
        connector: action.updateConnector
          ? { key: connector.key, version: connector.version }
          : deployment.connector,
        status: "Deployed",
        version: deployment.version + 1,
      };
      return Response.json(deployment);
    }
    return deployment === null
      ? Response.json({}, { status: 404 })
      : Response.json(deployment);
  };
  const options: DeployConnectOptions = {
    connectorKey: "event-proxy",
    connectorVersion: 7,
    deploymentKey: "catalog-events",
    dryRun: false,
    endpoint: "https://api.example.com/webhooks/commercetools",
    redeploy: false,
    timeoutSeconds: 10,
    type: "sandbox",
  };
  const layer = connectAdministrationLayer.pipe(
    Layer.provide(connectHttpClientLayer(fetchApi)),
    Layer.provideMerge(Layer.succeed(BootstrapCommercetoolsConfig, bootstrap))
  );
  return {
    configurations: () => configurations,
    counts: () => ({
      deploymentCreates: requests.filter(
        ({ method, path }) => method === "POST" && path.endsWith("/deployments")
      ).length,
      redeploys: requests.filter(
        ({ method, path }) => method === "POST" && path.includes("/key=")
      ).length,
      tokenRequests: requests.filter(({ path }) => path === "/oauth/token")
        .length,
    }),
    loseCreateResponse: () => {
      loseCreateResponse = true;
    },
    omitAppTopic: () => {
      appTopic = undefined;
    },
    requests,
    run: (
      override: Partial<DeployConnectOptions> = {},
      environment: Record<string, string> = defaultEnvironment
    ) =>
      deployConnectProxy(
        { ...options, ...override },
        ConfigProvider.fromUnknown(environment)
      ).pipe(Effect.provide(layer)),
    setConnector: (value: Connector) => {
      connector = value;
    },
    setDeployment: (value: Deployment) => {
      deployment = value;
      configurations = value.applications.map((application) => ({
        ...application,
        securedConfiguration: [],
      }));
    },
    setSubscriptionDestination: (value: typeof deployedTopic) => {
      subscriptionDestination = value;
    },
    setSubscriptionHealth: (value: VerifiedSubscription["health"]) => {
      subscriptionHealth = value;
    },
    subscriptionMissing: () => {
      subscriptionMissing = true;
    },
    wait: (initial: Deployment, timeout: number) =>
      waitForConnectDeployment(initial, timeout).pipe(Effect.provide(layer)),
  };
});
const scoped = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.scoped(program).pipe(Effect.provide(NodeServices.layer));
const queuedDeployment: Deployment = {
  apiClient: managedClient,
  applications: [],
  connector: { key: "event-proxy", version: 7 },
  deployedRegion: "us-central1.gcp",
  id: "deployment-1",
  key: "catalog-events",
  status: "Queued",
  type: "sandbox",
  version: 1,
};

describe("Connect deployment", () => {
  it.effect("reports elapsed time and status while waiting for Connect", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.setDeployment({ ...queuedDeployment, status: "Deployed" });
        const messages: string[] = [];
        const fiber = yield* f.wait(queuedDeployment, 10).pipe(
          Effect.provideService(CommandProgress, {
            note: (message) =>
              Effect.sync(() => {
                messages.push(message);
              }),
            phase: (_step, operation) => operation,
          }),
          Effect.forkChild
        );
        yield* TestClock.adjust("3 seconds");
        expect((yield* Fiber.join(fiber)).status).toBe("Deployed");
        expect(messages).toContain(
          "catalog-events: Queued · 0s elapsed · timeout 10s"
        );
      })
    )
  );

  it.effect("bounds the wait without deleting the running deployment", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const fiber = yield* f.wait(queuedDeployment, 1).pipe(Effect.forkChild);
        yield* TestClock.adjust("1 second");
        expect((yield* Fiber.join(fiber).pipe(Effect.flip)).operation).toBe(
          "timeout"
        );
        expect(f.requests).toHaveLength(0);
      })
    )
  );

  it.effect("validates the creation plan without submitting mutations", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        expect((yield* f.run({ dryRun: true })).action).toBe("would-create");
        expect(
          f.requests.filter(
            ({ method, path }) => method !== "GET" && path !== "/oauth/token"
          )
        ).toEqual([]);
        expect(f.counts().deploymentCreates).toBe(0);
      })
    )
  );

  it.effect(
    "deploys Connect-managed credentials with the supplied receiver secret and event selection",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          const first = yield* f.run();
          const second = yield* f.run();
          expect([
            first.action,
            second.action,
            second.subscriptionVerified,
          ]).toEqual(["created", "reused", true]);
          expect(f.counts()).toEqual({
            deploymentCreates: 1,
            redeploys: 0,
            tokenRequests: 2,
          });
          expect(f.configurations()[0]?.securedConfiguration).toEqual([
            { key: "WEBHOOK_SECRET", value: "receiver-secret" },
          ]);
          expect(
            f.configurations()[0]?.standardConfiguration.map(({ key }) => key)
          ).toEqual([
            "API_ENDPOINT",
            "SUBSCRIPTION_SUFFIX",
            "SUBSCRIPTION_CONFIG",
          ]);
        })
      )
  );

  it.effect(
    "requires explicit redeploy to apply a changed endpoint or webhook secret",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.run();
          const error = yield* f
            .run({
              endpoint: "https://other.example.com/webhooks/commercetools",
            })
            .pipe(Effect.flip);
          expect(error.message).toContain("--redeploy");
          const receipt = yield* f.run(
            {
              endpoint: "https://other.example.com/webhooks/commercetools",
              redeploy: true,
            },
            { COMMERCETOOLS_WEBHOOK_SECRET: "updated-receiver-secret" }
          );
          expect(receipt.action).toBe("redeployed");
          expect(f.configurations()[0]?.securedConfiguration).toEqual([
            { key: "WEBHOOK_SECRET", value: "updated-receiver-secret" },
          ]);
          const update = f.requests.find(
            ({ method, path }) => method === "POST" && path.includes("/key=")
          );
          expect(update?.body).toContain('"updateConnector":false');
        })
      )
  );

  it.effect("resumes an installation after a lost creation response", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.loseCreateResponse();
        const error = yield* f.run().pipe(Effect.flip);
        expect(error.message).not.toContain("private-provider-secret");
        expect((yield* f.run()).action).toBe("reused");
        expect(f.counts().deploymentCreates).toBe(1);
      })
    )
  );

  it.effect("recovers a draft and preserves its forwarding headers", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const forwardingHeaders = {
          key: "ADDITIONAL_HEADERS",
          value: '{"X-Forwarding-Key":"configured-value"}',
        };
        f.setDeployment({
          ...queuedDeployment,
          applications: [
            {
              applicationName: "event",
              standardConfiguration: [
                { key: "SUBSCRIPTION_SUFFIX", value: "catalog-events" },
                forwardingHeaders,
              ],
            },
          ],
          status: "Draft",
        });
        const error = yield* f.run().pipe(Effect.flip);
        expect(error.message).toContain("Rerun with --redeploy");
        expect(f.counts().redeploys).toBe(0);

        const receipt = yield* f.run({ redeploy: true });
        expect(receipt.action).toBe("redeployed");
        expect(f.configurations()[0]?.standardConfiguration).toContainEqual(
          forwardingHeaders
        );
      })
    )
  );

  it.effect(
    "requires the original installation and subscription key on redeploy",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          const missing = yield* f.run({ redeploy: true }).pipe(Effect.flip);
          expect(missing.message).toContain(
            "Redeploy requires the existing deployment key"
          );
          f.setDeployment({
            ...queuedDeployment,
            applications: [
              {
                applicationName: "event",
                standardConfiguration: [
                  { key: "SUBSCRIPTION_SUFFIX", value: "legacy-events" },
                ],
              },
            ],
            status: "Deployed",
          });
          const different = yield* f.run({ redeploy: true }).pipe(Effect.flip);
          expect(different.message).toContain(
            "Redeploy cannot change the subscription key"
          );
          expect(different.message).toContain("uninstall the existing app");
          expect(f.counts()).toMatchObject({
            deploymentCreates: 0,
            redeploys: 0,
          });
        })
      )
  );

  it.effect(
    "upgrades an existing installation to the requested latest managed Connector",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          f.setDeployment({
            ...queuedDeployment,
            apiClient: undefined,
            applications: [
              {
                applicationName: "event",
                standardConfiguration: [
                  { key: "SUBSCRIPTION_SUFFIX", value: "catalog-events" },
                ],
              },
            ],
            connector: { key: "event-proxy", version: 6 },
            status: "Deployed",
          });
          const receipt = yield* f.run({ redeploy: true });
          expect(receipt).toMatchObject({
            action: "redeployed",
            connectorVersion: 7,
          });
          expect(f.counts()).toMatchObject({
            deploymentCreates: 0,
            redeploys: 1,
          });
          const update = f.requests.find(
            ({ method, path }) => method === "POST" && path.includes("/key=")
          );
          expect(update?.body).toContain('"updateConnector":true');
        })
      )
  );

  it.effect(
    "rejects a Connector without the required managed credential scope",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          f.setConnector({ key: "event-proxy", version: 7 });
          const error = yield* f.run().pipe(Effect.flip);
          expect(error.message).toContain("Connect-managed credentials");
          expect(f.counts().deploymentCreates).toBe(0);
        })
      )
  );

  it.effect(
    "rejects a requested version that is not the published upgrade target",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          f.setConnector({
            apiClient: managedClient,
            key: "event-proxy",
            version: 8,
          });
          const error = yield* f.run().pipe(Effect.flip);
          expect(error.message).toContain("currently published at version 8");
          expect(f.counts().deploymentCreates).toBe(0);
        })
      )
  );

  it.effect("requires the native Subscription before reporting success", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.subscriptionMissing();
        const error = yield* f.run().pipe(Effect.flip);
        expect(error.operation).toBe("verifySubscription");
        expect(error.message).toContain("postDeploy");
      })
    )
  );

  it.effect(
    "rejects a topic in a different project even when its name matches",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          f.setSubscriptionDestination({
            ...deployedTopic,
            projectId: "old-connect-project",
          });
          const error = yield* f.run().pipe(Effect.flip);
          expect(error.operation).toBe("verifySubscription");
          expect(error.message).toContain("different topic");
        })
      )
  );

  it.effect(
    "requires the deployed app's topic to verify the subscription",
    () =>
      scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          f.omitAppTopic();
          const error = yield* f.run().pipe(Effect.flip);
          expect(error.operation).toBe("verifySubscription");
          expect(error.message).toContain("did not report a topic");
        })
      )
  );

  it.effect("reports the health of a matching subscription from one read", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.setSubscriptionHealth("TemporaryError");
        const receipt = yield* f.run();
        expect(receipt).toMatchObject({
          subscription: { health: "TemporaryError", topic: topicPath },
          subscriptionVerified: true,
        });
        expect(connectDeploymentReport(receipt).outcome).toBe(
          "action-required"
        );
        expect(
          f.requests
            .filter(({ path }) => path.includes("/subscriptions/"))
            .map(({ method }) => method)
        ).toEqual(["GET"]);
      })
    )
  );

  it.effect("rejects a different deployment target before changing it", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.setDeployment({
          ...queuedDeployment,
          connector: { key: "another-proxy", version: 7 },
          status: "Deployed",
        });
        expect((yield* f.run().pipe(Effect.flip)).message).toContain(
          "another Connector"
        );
        expect(f.counts().redeploys).toBe(0);
      })
    )
  );

  it.effect("requires the receiving API's signing secret", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        expect((yield* f.run({}, {}).pipe(Effect.flip)).message).toContain(
          "COMMERCETOOLS_WEBHOOK_SECRET"
        );
        expect(f.requests).toHaveLength(0);
      })
    )
  );

  it.effect("rejects invalid targets before sending requests", () =>
    scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        expect(
          (yield* f
            .run({ endpoint: "https://store.example.com" })
            .pipe(Effect.flip)).message
        ).toContain("HTTPS receiver URL");
        expect(f.requests).toHaveLength(0);
      })
    )
  );
});
