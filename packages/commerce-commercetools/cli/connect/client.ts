import {
  Array as EffectArray,
  Cache,
  Duration,
  Effect,
  Exit,
  Layer,
  Order,
  Schema,
  flow,
} from "effect";
import type { Redacted } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import { BootstrapCommercetoolsConfig } from "../project-provisioning/bootstrap-config";
import type { DeploymentInput, ProxyConfiguration } from "./model";
import {
  ConnectAdministration,
  ConnectDeploymentError,
  Connector,
  Deployment,
  Subscription,
  SubscriptionHealth,
  connectFailure,
} from "./model";

const Token = Schema.Struct({
  access_token: Schema.RedactedFromValue(Schema.NonEmptyString),
  expires_in: Schema.Int.check(Schema.isGreaterThan(60)),
});
const regions = new Set([
  "us-central1.gcp",
  "europe-west1.gcp",
  "australia-southeast1.gcp",
  "eu-central-1.aws",
  "us-east-2.aws",
]);

type ConnectRequestBody =
  | DeploymentInput
  | {
      readonly version: number;
      readonly actions: readonly {
        readonly action: "redeploy";
        readonly configurationValues: readonly ProxyConfiguration[];
        readonly skipScripts: boolean;
        readonly updateConnector: boolean;
      }[];
    };
const decodeDeployment = flow(
  Schema.decodeUnknownEffect(Deployment),
  Effect.mapError(() =>
    connectFailure(
      "decodeDeployment",
      "Connect returned an invalid Deployment."
    )
  )
);
const NativeSubscription = Schema.Struct({
  changes: Subscription.fields.changes.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  destination: Schema.Union([
    Schema.Struct({
      projectId: Schema.NonEmptyString,
      topic: Schema.NonEmptyString,
      type: Schema.Literal("GoogleCloudPubSub"),
    }),
    Schema.Struct({
      topicArn: Schema.NonEmptyString,
      type: Schema.Literal("SNS"),
    }),
  ]),
  messages: Subscription.fields.messages.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  status: SubscriptionHealth,
});

const subscriptionSignature = (subscription: Subscription) =>
  JSON.stringify({
    changes: EffectArray.sort(
      subscription.changes.map(({ resourceTypeId }) => resourceTypeId),
      Order.String
    ),
    messages: EffectArray.sort(
      subscription.messages.map(({ resourceTypeId, types }) => ({
        resourceTypeId,
        types: EffectArray.sort(types, Order.String),
      })),
      Order.mapInput(
        Order.String,
        (message: Subscription["messages"][number]) => message.resourceTypeId
      )
    ),
  });

/** Effect HTTP owns OAuth, response decoding and timeouts; mutation requests are never retried blindly. */
export const connectAdministrationLayer = Layer.effect(
  ConnectAdministration,
  Effect.gen(function* () {
    const config = yield* BootstrapCommercetoolsConfig;
    const http = yield* HttpClient.HttpClient;
    if (
      !regions.has(config.region) ||
      config.apiUrl !== `https://api.${config.region}.commercetools.com` ||
      config.authUrl !== `https://auth.${config.region}.commercetools.com`
    ) {
      return yield* connectFailure(
        "configuration",
        "Connect requires matching official commercetools API/auth hosts in a supported Region."
      );
    }
    const connectUrl = `https://connect.${config.region}.commercetools.com`;
    const makeRequest = (
      clientId: string,
      secret: Redacted.Redacted,
      scopes: readonly string[]
    ) =>
      Effect.gen(function* () {
        const cache = yield* Cache.makeWith(
          () =>
            Effect.gen(function* () {
              const response = yield* http.execute(
                HttpClientRequest.post(`${config.authUrl}/oauth/token`).pipe(
                  HttpClientRequest.basicAuth(clientId, secret),
                  HttpClientRequest.bodyUrlParams({
                    grant_type: "client_credentials",
                    scope: scopes.join(" "),
                  })
                )
              );
              if (response.status !== 200) {
                return yield* connectFailure(
                  "authentication",
                  `Commercetools token exchange failed (HTTP ${response.status}). Check CTP_CLIENT_ID, CTP_CLIENT_SECRET and CTP_SCOPES in --env-file.`
                );
              }
              return yield* HttpClientResponse.schemaBodyJson(Token)(response);
            }).pipe(Effect.timeout("30 seconds")),
          {
            capacity: 1,
            timeToLive: (exit) =>
              Exit.isSuccess(exit)
                ? Duration.seconds(exit.value.expires_in - 60)
                : Duration.zero,
          }
        );
        return (
          operation: string,
          method: "GET" | "POST",
          url: string,
          body?: ConnectRequestBody
        ) =>
          Effect.gen(function* () {
            const token = yield* Cache.get(cache, "token");
            let request = HttpClientRequest.make(method)(url).pipe(
              HttpClientRequest.bearerToken(token.access_token)
            );
            if (body !== undefined) {
              request = yield* HttpClientRequest.bodyJson(body)(request);
            }
            const response = yield* http.execute(request);
            if (method === "GET" && response.status === 404) {
              return null;
            }
            if (response.status < 200 || response.status >= 300) {
              return yield* connectFailure(
                operation,
                `${operation} failed (HTTP ${response.status}). Check Connect permissions and configuration; no response body is printed.`
              );
            }
            return yield* response.json;
          }).pipe(
            Effect.timeout("30 seconds"),
            Effect.mapError((error) =>
              Schema.is(ConnectDeploymentError)(error)
                ? error
                : connectFailure(
                    operation,
                    `${operation} could not be confirmed. Inspect the resource before retrying a mutation; credentials and provider response bodies are not printed.`
                  )
            )
          );
      });
    const request = yield* makeRequest(
      config.clientId,
      config.clientSecret,
      config.scopes
    );
    const deploymentUrl = (key?: string) =>
      `${connectUrl}/${encodeURIComponent(config.projectKey)}/deployments${key === undefined ? "" : `/key=${encodeURIComponent(key)}`}`;
    return ConnectAdministration.of({
      createDeployment: Effect.fn("Connect.createDeployment")(
        function* (input) {
          return yield* decodeDeployment(
            yield* request("createDeployment", "POST", deploymentUrl(), input)
          );
        }
      ),
      getConnector: Effect.fn("Connect.getConnector")(function* (key) {
        const data = yield* request(
          "readConnector",
          "GET",
          `${connectUrl}/connectors/key=${encodeURIComponent(key)}`
        );
        return yield* Schema.decodeUnknownEffect(Connector)(data).pipe(
          Effect.mapError(() =>
            connectFailure(
              "readConnector",
              `Published Connector ${key} was not found or returned an invalid configuration.`
            )
          )
        );
      }),
      getDeployment: Effect.fn("Connect.getDeployment")(function* (key) {
        const data = yield* request(
          "readDeployment",
          "GET",
          deploymentUrl(key)
        );
        return data === null ? null : yield* decodeDeployment(data);
      }),
      redeploy: Effect.fn("Connect.redeploy")(
        function* (deployment, configurations, updateConnector) {
          return yield* decodeDeployment(
            yield* request("redeploy", "POST", deploymentUrl(deployment.key), {
              actions: [
                {
                  action: "redeploy",
                  configurationValues: configurations,
                  skipScripts: false,
                  updateConnector,
                },
              ],
              version: deployment.version,
            })
          );
        }
      ),
      verifySubscription: Effect.fn("Connect.verifySubscription")(
        function* (deployment, expected) {
          const data = yield* request(
            "verifySubscription",
            "GET",
            `${config.apiUrl}/${encodeURIComponent(config.projectKey)}/subscriptions/key=ct-event-proxy-subscription-${encodeURIComponent(deployment.key)}`
          );
          const actual = yield* Schema.decodeUnknownEffect(NativeSubscription)(
            data
          ).pipe(
            Effect.mapError(() =>
              connectFailure(
                "verifySubscription",
                "Deployment finished but its native Subscription is missing or invalid. Check postDeploy logs."
              )
            )
          );
          if (
            subscriptionSignature(actual) !== subscriptionSignature(expected)
          ) {
            return yield* connectFailure(
              "verifySubscription",
              "The deployed native Subscription does not match the requested events. Check postDeploy logs."
            );
          }
          const appTopic = deployment.applications.find(
            ({ applicationName }) => applicationName === "event"
          )?.topic;
          if (!appTopic) {
            return yield* connectFailure(
              "verifySubscription",
              `Connect did not report a topic for the deployed event app. Subscription health is ${actual.status}.`
            );
          }
          const { destination } = actual;
          const topic =
            destination.type === "GoogleCloudPubSub"
              ? `projects/${destination.projectId}/topics/${destination.topic}`
              : destination.topicArn;
          if (topic !== appTopic) {
            return yield* connectFailure(
              "verifySubscription",
              `The native Subscription points to a different topic than the deployed event app. Subscription health is ${actual.status}. Check postDeploy logs.`
            );
          }
          return { health: actual.status, topic };
        }
      ),
    });
  })
);

export const connectHttpClientLayer = (
  fetchApi: typeof fetch = globalThis.fetch
) =>
  Layer.fresh(FetchHttpClient.layer).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(FetchHttpClient.Fetch, fetchApi),
        Layer.succeed(FetchHttpClient.RequestInit, {
          cache: "no-store",
          redirect: "error",
        })
      )
    )
  );
