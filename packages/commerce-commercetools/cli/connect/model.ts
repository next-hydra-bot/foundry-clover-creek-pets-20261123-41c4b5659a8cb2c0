import { Context, Effect, Schema } from "effect";

export class ConnectDeploymentError extends Schema.TaggedError<ConnectDeploymentError>()(
  "ConnectDeploymentError",
  { message: Schema.String, operation: Schema.String }
) {}

export const connectFailure = (operation: string, message: string) =>
  new ConnectDeploymentError({ message, operation });

export const ConnectKey = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{2,256}$/u)
);
export const Configuration = Schema.Struct({
  applicationName: Schema.String,
  standardConfiguration: Schema.Array(
    Schema.Struct({ key: Schema.String, value: Schema.String })
  ),
  topic: Schema.optional(Schema.NullOr(Schema.String)),
});
const ManagedApiClient = Schema.Struct({ scopes: Schema.Array(Schema.String) });
export const Connector = Schema.Struct({
  apiClient: Schema.optional(ManagedApiClient),
  key: ConnectKey,
  version: Schema.Int,
});
export type Connector = typeof Connector.Type;
export const Deployment = Schema.Struct({
  apiClient: Schema.optional(ManagedApiClient),
  applications: Schema.Array(Configuration).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  connector: Schema.Struct({ key: Schema.NonEmptyString, version: Schema.Int }),
  deployedRegion: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  key: ConnectKey,
  status: Schema.Literals([
    "Draft",
    "Queued",
    "Deploying",
    "Deployed",
    "Failed",
    "Undeploying",
    "UndeployFailed",
  ]),
  type: Schema.Literals(["sandbox", "production", "preview"]),
  version: Schema.Int,
});
export type Deployment = typeof Deployment.Type;

export interface ProxyConfiguration {
  readonly applicationName: string;
  readonly standardConfiguration: readonly {
    readonly key: string;
    readonly value: string;
  }[];
  readonly securedConfiguration: readonly {
    readonly key: string;
    readonly value: string;
  }[];
}
export interface DeploymentInput {
  readonly key: string;
  readonly connector: { readonly key: string; readonly version: number };
  readonly type: "sandbox" | "production";
  readonly region: string;
  readonly configurations: readonly ProxyConfiguration[];
}
export const SubscriptionHealth = Schema.Literals([
  "Healthy",
  "ConfigurationError",
  "ConfigurationErrorDeliveryStopped",
  "TemporaryError",
  "ManuallySuspended",
]);
export interface VerifiedSubscription {
  readonly health: typeof SubscriptionHealth.Type;
  readonly topic: string;
}
export interface ConnectDeploymentReceipt {
  readonly action:
    | "would-create"
    | "would-redeploy"
    | "would-reuse"
    | "created"
    | "redeployed"
    | "reused";
  readonly deploymentKey: string;
  readonly connectorKey: string;
  readonly connectorVersion: number;
  readonly projectKey: string;
  readonly endpoint: string;
  readonly status: Deployment["status"] | "NotCreated";
  readonly subscription?: VerifiedSubscription;
  readonly subscriptionVerified: boolean;
}
export interface ConnectAdministrationValue {
  readonly getConnector: (
    key: string
  ) => Effect.Effect<Connector, ConnectDeploymentError>;
  readonly getDeployment: (
    key: string
  ) => Effect.Effect<Deployment | null, ConnectDeploymentError>;
  readonly createDeployment: (
    input: DeploymentInput
  ) => Effect.Effect<Deployment, ConnectDeploymentError>;
  readonly redeploy: (
    deployment: Deployment,
    configurations: readonly ProxyConfiguration[],
    updateConnector: boolean
  ) => Effect.Effect<Deployment, ConnectDeploymentError>;
  readonly verifySubscription: (
    deployment: Deployment,
    subscription: Subscription
  ) => Effect.Effect<VerifiedSubscription, ConnectDeploymentError>;
}
export const Subscription = Schema.Struct({
  changes: Schema.Array(Schema.Struct({ resourceTypeId: Schema.String })),
  messages: Schema.Array(
    Schema.Struct({
      resourceTypeId: Schema.String,
      types: Schema.Array(Schema.String),
    })
  ),
});
export type Subscription = typeof Subscription.Type;

export class ConnectAdministration extends Context.Service<
  ConnectAdministration,
  ConnectAdministrationValue
>()("@repo/commerce-commercetools/ConnectAdministration") {}
