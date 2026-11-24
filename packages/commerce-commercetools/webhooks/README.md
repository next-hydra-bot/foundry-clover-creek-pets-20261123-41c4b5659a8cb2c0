# commercetools webhook receiver

The `commerce-commercetools-webhooks` recipe owns the API receiver at `POST /webhooks/commercetools`. It verifies the raw-body signature and project once, then dispatches to package-owned consumers. It is independent of Connect deployment and can receive deliveries from any trusted relay implementing the signed protocol below.

The cached catalog installs `commerce-commercetools-catalog-events` automatically. That recipe installs the receiver, catalog consumer and native Subscription definition, and configures the handoff to the web baseline’s shared revalidation endpoint. Selecting `commerce-order-workflow` adds its order/payment consumer and Subscription definition to the same receiver, whether or not Connect is selected. Other feature recipes can add consumers without changing the API route. B2C installs the API shell without company registration, Admin or company permissions.

The `commerce-commercetools-connect-proxy` recipe supplies the optional hosted sender and its deployment instructions. One deployment uses the Subscription assembled from installed features. Receiver installation, consumer selection and catalog cache invalidation do not depend on this recipe. Composition installs code and setup instructions; external resources are provisioned separately.

## Catalog invalidation

Event processing runs in API, while the catalog cache belongs to web:

```text
Trusted sender → API /webhooks/commercetools
  → catalogEventConsumer maps the change to cache tags
  → web /api/revalidate
  → revalidateTag
```

The API forwards the derived cache tags through Effect HttpClient. Web authenticates the private request and invalidates its own cache tags. The API does not call Next cache invalidation against its own cache.

## Runtime configuration

Set `COMMERCETOOLS_PROJECT_KEY` to the expected project and configure a strong `COMMERCETOOLS_WEBHOOK_SECRET` shared with the trusted sender. For Connect, supply the same signing secret in the CLI input file and API environment (`apps/api/.env.local` during local development). Existing matching values need no change. Connect creates and injects the proxy's subscription credentials; there is no generated proxy credentials file to copy.

For Vercel Services, declare a service binding from API to web and name it `WEB_INTERNAL_URL`. API sends the request to `/api/revalidate` using that binding. For Portless or separate deployments, set the full fallback URL in `REVALIDATION_ENDPOINT`. Configure the same secret on both apps:

```dotenv
# API app
REVALIDATION_ENDPOINT=https://web.example.com/api/revalidate # fallback without a binding
REVALIDATION_SECRET=<strong-shared-cache-secret>

# Web app: same cache secret; no Connect signing secret required
REVALIDATION_SECRET=<strong-shared-cache-secret>
```

The catalog consumer posts the derived cache tags to this protected web endpoint using a bearer token. Web expires its own cache tags immediately. A failed or timed-out handoff returns a retryable failure to the sender. Configure deployment-protection access for both hops where applicable. Missing configuration, transport errors, timeouts and downstream HTTP rejections are logged as separate diagnostics in API. For example, a wrong web secret records downstream status `401` while returning retryable `503` to the sender; request credentials are never logged. The internal revalidation endpoint supports local HTTP development; use HTTPS for the public API receiver.

Catalog Change Subscriptions cover products/categories, inventory, standalone prices, product discounts/types, Store selections/tailoring and channels. Broad dependencies expire broadly. Repeated or out-of-order events are safe: refills reread current platform state. Public Product Search uses the `hours` fallback because its projection is eventually consistent. Algolia ingestion completes separately, so native events leave its short result cache on its timed policy. See [Core cache policy](../../commerce-core/README.md#catalog-caching).

Order processing contributes a consumer for the Message types in [`orders/subscription.ts`](../orders/subscription.ts). `OrderCreated` admits the run. Shipment and parcel changes wake fulfillment. Payment changes wake an open payment hook. The workflow reads the provider's current state on wakeup. If an eligible Order update arrives before admission, the API returns HTTP 503 so the relay retries. See [order workflows](../../commerce-core/orders/README.md).

## Signed receiver protocol

Any trusted relay can send the normalized JSON envelope to the API receiver. It contains `notificationType`, `projectKey`, `resourceTypeId`, `resourceId`, optional `messageType`, a string `timestamp`, and the original native Platform notification in `data`. The receiver checks that native project/resource/type fields agree with the envelope. Truncated native Messages can identify their type through `payloadNotIncluded.payloadType`.

Set `x-webhook-source: commercetools-event-proxy`, `x-webhook-timestamp` to current Unix milliseconds, and `x-webhook-signature` to `sha256=<hex HMAC-SHA256 of timestamp + "." + exact raw body>`, using `COMMERCETOOLS_WEBHOOK_SECRET`. This wire protocol is compatible with the Connect proxy; it does not require the sender to run on Connect. Sign each forwarding attempt with a current timestamp; the receiver allows five minutes of clock skew.

The receiver acknowledges unrelated valid events and returns retryable `503` when a consumer fails. Each consumer must tolerate duplicate delivery, because a later consumer's failure causes the sender to retry the delivery. The receiver returns `4xx` for authentication and payload rejections. The Connect proxy reports these as failed deliveries so Connect can retry after the configuration is corrected.

## Recipes and event definitions

`commerce-commercetools-webhooks` owns the API route, signature verification, dispatch and consumer/subscription template slots. It has no Connect deployment dependency. `commerce-commercetools-catalog-events` owns the catalog consumer and catalog event definition. The web baseline owns the shared `/api/revalidate` route. `commerce-commercetools-order-workflow` owns the Order/Payment consumer and its event definition. Both contribute to `webhooks/consumers.ts` and `webhooks/subscription.ts`; feature events are selected at composition time and do not need a manually maintained event list during provisioning.

The catalog definition is in `product/subscription.json`; the order definition is in `orders/subscription.ts`. Other recipes can contribute their own pure definition and runtime consumer to those same slots. Handlers must tolerate duplicate delivery. The optional Connect deployment command reads the composed Subscription without loading the runtime consumers.

Setup steps are owned by the receiver and feature recipes, so they accompany the corresponding installed code. Verify delivery with a sandbox product update; if order workflows are installed, also verify an Order update and its durable workflow. Source-level checks do not prove live delivery.

The B2B company recipe also contributes Business Unit and Customer changes and associate-removal messages. Its consumer starts a Workflow SDK run to synchronize customer identity role metadata. Its ID-only reconciliation checkpoints and initial seed command are documented in [company identity synchronization](../company/identity-sync.md).
