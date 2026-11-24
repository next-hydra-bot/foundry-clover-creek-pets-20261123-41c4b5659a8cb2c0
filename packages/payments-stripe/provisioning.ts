import { createHash } from "node:crypto";
import { parseEnv } from "node:util";

import { PrivateDotEnvFile } from "@repo/cli-core/private-dotenv";
import {
  Array as EffectArray,
  Effect,
  FileSystem,
  Order,
  Path,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const stripeVersion = "2026-10-28.endive";
const stripeAccountId = /^acct_[A-Za-z0-9]+$/u;
const stripeEndpointId = /^we_[A-Za-z0-9]+$/u;
const stripeSigningSecret = /^whsec_[A-Za-z0-9_-]+$/u;
const webhookOwnershipKey = "checkout_provisioning";
const listPage = <S extends Schema.Top>(item: S) =>
  Schema.Struct({ data: Schema.Array(item), has_more: Schema.Boolean });

const Account = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(stripeAccountId)),
});
const PaymentConfiguration = Schema.Struct({
  active: Schema.Boolean,
  card: Schema.NullOr(
    Schema.Struct({
      available: Schema.Boolean,
      display_preference: Schema.Struct({ value: Schema.String }),
    })
  ),
  id: Schema.String,
  is_default: Schema.Boolean,
  livemode: Schema.Boolean,
});
const Webhook = Schema.Struct({
  enabled_events: Schema.Array(Schema.String),
  id: Schema.String.check(Schema.isPattern(stripeEndpointId)),
  livemode: Schema.Boolean,
  metadata: Schema.Record(Schema.String, Schema.String),
  secret: Schema.optional(Schema.String),
  status: Schema.String,
  url: Schema.String,
});

interface WebhookOptions {
  readonly url?: string;
  readonly events: readonly string[];
  readonly output?: string;
}

export class StripeProvisioningError extends Schema.TaggedError<StripeProvisioningError>()(
  "StripeProvisioningError",
  { message: Schema.String }
) {}

const failure = (message: string) => new StripeProvisioningError({ message });

const webhookOptions = Effect.fn("StripeProvisioning.webhookOptions")(
  function* (options: WebhookOptions) {
    if (!options.url && !options.output && options.events.length === 0) {
      return;
    }

    const url = URL.parse(options.url ?? "");
    if (
      url?.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return yield* failure(
        "Use a public HTTPS --webhook-url without credentials, query, or fragment."
      );
    }
    const events = EffectArray.sort([...new Set(options.events)], Order.String);
    if (
      !events.length ||
      events.some((event) => !/^[a-z][a-z_]*(?:\.[a-z][a-z_]*)+$/u.test(event))
    ) {
      return yield* failure(
        "Supply explicit Stripe event types using --webhook-event. Wildcards are unsupported."
      );
    }
    if (!options.output?.trim()) {
      return yield* failure(
        "Supply --webhook-output with a private dotenv path outside the workspace repository."
      );
    }
    return { events, output: options.output, url: url.href };
  }
);

const makeStripeSandboxClient = (
  http: HttpClient.HttpClient,
  accountId: string | undefined,
  key: string
) => {
  const request = Effect.fn("StripeProvisioning.request")(function* <A>(
    route: string,
    operation: string,
    schema: Schema.Decoder<A>,
    write?: { readonly form: URLSearchParams; readonly idempotencyKey?: string }
  ) {
    let httpRequest = HttpClientRequest.make(write ? "POST" : "GET")(
      `https://api.stripe.com/v1/${route}`
    ).pipe(
      HttpClientRequest.bearerToken(key),
      HttpClientRequest.setHeader("Stripe-Version", stripeVersion)
    );
    if (accountId && key.startsWith("sk_org_")) {
      httpRequest = HttpClientRequest.setHeader(
        httpRequest,
        "Stripe-Context",
        accountId
      );
    }
    if (write !== undefined) {
      httpRequest = HttpClientRequest.bodyUrlParams(httpRequest, write.form);
      if (write.idempotencyKey !== undefined) {
        httpRequest = HttpClientRequest.setHeader(
          httpRequest,
          "Idempotency-Key",
          write.idempotencyKey
        );
      }
    }
    const response = yield* http.execute(httpRequest).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError(() =>
        failure(`Could not reach Stripe during ${operation}.`)
      )
    );
    if (response.status < 200 || response.status >= 300) {
      const id = response.headers["request-id"] ?? "";
      const requestId = /^req_[A-Za-z0-9]+$/u.test(id) ? ` (${id})` : "";
      return yield* failure(
        `Stripe ${operation} returned HTTP ${response.status}${requestId}.`
      );
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError(() =>
        failure(`Could not verify the Stripe response during ${operation}.`)
      )
    );
  });

  const list = Effect.fn("StripeProvisioning.list")(function* <
    A extends { readonly id: string },
  >(
    route: string,
    schema: Schema.Decoder<{
      readonly data: readonly A[];
      readonly has_more: boolean;
    }>
  ) {
    const items: A[] = [];
    let cursor: string | undefined;
    for (;;) {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor !== undefined) {
        query.set("starting_after", cursor);
      }
      const page = yield* request(`${route}?${query}`, `list ${route}`, schema);
      items.push(...page.data);
      if (!page.has_more) {
        return items;
      }
      const next = page.data.at(-1)?.id;
      if (next === undefined || next === cursor) {
        return yield* failure(
          `Stripe returned an invalid page while listing ${route}.`
        );
      }
      cursor = next;
    }
  });

  return { list, request };
};

const findSandboxCardConfiguration = Effect.fn(
  "StripeProvisioning.findCardConfiguration"
)(function* (client: ReturnType<typeof makeStripeSandboxClient>) {
  const configurations = yield* client.list(
    "payment_method_configurations",
    listPage(PaymentConfiguration)
  );
  const defaults = configurations.filter(
    (configuration) => configuration.active && configuration.is_default
  );
  const configuration = defaults.length === 1 ? defaults[0] : undefined;
  if (!configuration || configuration.livemode) {
    return yield* failure(
      "Stripe did not return a unique active test-mode default payment method configuration."
    );
  }
  return configuration;
});

const configureCards = Effect.fn("StripeProvisioning.configureCards")(
  function* (
    client: ReturnType<typeof makeStripeSandboxClient>,
    configuration: typeof PaymentConfiguration.Type
  ) {
    const current =
      configuration.card?.display_preference.value === "on"
        ? configuration
        : yield* client.request(
            `payment_method_configurations/${encodeURIComponent(configuration.id)}`,
            "enable cards",
            PaymentConfiguration,
            {
              form: new URLSearchParams({
                "card[display_preference][preference]": "on",
              }),
            }
          );
    if (
      current.livemode ||
      current.id !== configuration.id ||
      !current.card?.available ||
      current.card.display_preference.value !== "on"
    ) {
      return yield* failure(
        "Stripe did not confirm cards are available and enabled in the target sandbox."
      );
    }
    return current.id;
  }
);

const provisionWebhook = Effect.fn("StripeProvisioning.provisionWebhook")(
  function* (
    client: ReturnType<typeof makeStripeSandboxClient>,
    accountId: string,
    webhook: Required<WebhookOptions>
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const privateFile = yield* PrivateDotEnvFile;
    const output = path.resolve(webhook.output);
    const ownership = createHash("sha256")
      .update(accountId)
      .update("\0")
      .update(webhook.url)
      .digest("hex");
    const matches = (endpoint: typeof Webhook.Type) =>
      !endpoint.livemode &&
      endpoint.url === webhook.url &&
      endpoint.metadata[webhookOwnershipKey] === ownership &&
      endpoint.status === "enabled";
    const hasRequestedEvents = (endpoint: typeof Webhook.Type) =>
      endpoint.enabled_events.length === webhook.events.length &&
      EffectArray.sort(endpoint.enabled_events, Order.String).every(
        (event, index) => event === webhook.events[index]
      );
    const events = new URLSearchParams(
      webhook.events.map((event) => ["enabled_events[]", event])
    );

    if (yield* fs.exists(output)) {
      const info = yield* fs.stat(output);
      if (info.type !== "File" || info.mode % 0o1000 !== 0o600) {
        return yield* failure(
          "The existing webhook dotenv file must be a private file with mode 0600."
        );
      }
      const saved = parseEnv(yield* fs.readFileString(output));
      const id = saved.STRIPE_WEBHOOK_ENDPOINT_ID ?? "";
      if (
        saved.STRIPE_WEBHOOK_ACCOUNT_ID !== accountId ||
        !stripeEndpointId.test(id) ||
        !stripeSigningSecret.test(saved.STRIPE_WEBHOOK_SECRET ?? "")
      ) {
        return yield* failure(
          "The existing webhook dotenv file does not match the selected Stripe sandbox."
        );
      }
      const route = `webhook_endpoints/${id}`;
      const current = yield* client.request(
        route,
        "verify saved webhook",
        Webhook
      );
      if (current.id !== id || !matches(current)) {
        return yield* failure(
          "The saved webhook does not match an enabled endpoint owned by this setup at the requested URL."
        );
      }
      const endpoint = hasRequestedEvents(current)
        ? current
        : yield* client.request(route, "update webhook events", Webhook, {
            form: events,
          });
      if (
        endpoint.id !== id ||
        !matches(endpoint) ||
        !hasRequestedEvents(endpoint)
      ) {
        return yield* failure(
          "Stripe did not confirm the requested webhook events."
        );
      }
      return { id, output };
    }

    yield* fs.access(path.dirname(output), { writable: true });
    const endpoints = yield* client.list(
      "webhook_endpoints",
      listPage(Webhook)
    );
    const existing = endpoints.find((endpoint) => endpoint.url === webhook.url);
    if (existing !== undefined) {
      return yield* failure(
        `Stripe webhook ${existing.id} already uses that URL. Reuse its original private output if created by this command, or reconcile the endpoint in Stripe before retrying.`
      );
    }

    events.set("url", webhook.url);
    events.set("api_version", stripeVersion);
    events.set(`metadata[${webhookOwnershipKey}]`, ownership);
    const created = yield* client.request(
      "webhook_endpoints",
      "create webhook",
      Webhook,
      {
        form: events,
        idempotencyKey: `checkout-webhook-${ownership}`,
      }
    );
    if (
      !matches(created) ||
      !hasRequestedEvents(created) ||
      created.secret === undefined ||
      !stripeSigningSecret.test(created.secret)
    ) {
      return yield* failure(
        `Stripe did not return verified test credentials for webhook ${created.id}. Reconcile the endpoint in Stripe before retrying.`
      );
    }
    yield* privateFile
      .publish(
        {
          STRIPE_WEBHOOK_ACCOUNT_ID: accountId,
          STRIPE_WEBHOOK_ENDPOINT_ID: created.id,
          STRIPE_WEBHOOK_SECRET: created.secret,
        },
        output
      )
      .pipe(
        Effect.mapError(() =>
          failure(
            `Stripe created webhook ${created.id}, but its signing secret could not be written. Check the private output or recover the secret in Stripe before retrying.`
          )
        )
      );
    return { id: created.id, output };
  }
);

export const provisionStripeSandbox = Effect.fn("StripeProvisioning.provision")(
  function* (
    expectedAccountId: string | undefined,
    provisioningKey: Redacted.Redacted,
    webhookInput: WebhookOptions
  ) {
    const key = Redacted.value(provisioningKey).trim();
    if (
      expectedAccountId !== undefined &&
      !stripeAccountId.test(expectedAccountId)
    ) {
      return yield* failure(
        "Supply a Stripe sandbox account ID beginning with acct_."
      );
    }
    if (!/^(?:sk_org_|sk_test_|rk_test_)/u.test(key)) {
      return yield* failure(
        "Use a sandbox test key or a restricted sandbox organization key for payments provisioning."
      );
    }

    if (key.startsWith("sk_org_") && expectedAccountId === undefined) {
      return yield* failure(
        "Supply --account-id when using a Stripe organization key."
      );
    }

    const webhook = yield* webhookOptions(webhookInput);
    const http = yield* HttpClient.HttpClient;
    const client = makeStripeSandboxClient(http, expectedAccountId, key);
    const { id: accountId } = yield* client.request(
      "account",
      "verify account",
      Account
    );
    if (expectedAccountId !== undefined && accountId !== expectedAccountId) {
      return yield* failure(
        "The Stripe key resolved to a different account. Verify the sandbox account ID and credential."
      );
    }
    const configuration = yield* findSandboxCardConfiguration(client);
    const configurationId = yield* configureCards(client, configuration);
    const endpoint =
      webhook === undefined
        ? undefined
        : yield* provisionWebhook(client, accountId, webhook);
    return { accountId, configurationId, webhook: endpoint };
  }
);
