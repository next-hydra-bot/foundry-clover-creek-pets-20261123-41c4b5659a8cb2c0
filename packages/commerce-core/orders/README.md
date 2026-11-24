# Custom order workflows

The `commerce-order-workflow` add-on is an explicit opt-in for application-owned order logic with either commerce provider and either buying flavor. It installs the selected provider's Workflow SDK implementation, a provider-owned event receiver, and Resend order emails. All implementation stays in packages; the application receives one route handler and the Workflow Next.js wrapper. Registration and the Admin application are independent of this recipe.

Shopify's standard order handling uses its native notifications, payment and fulfillment state, and configured automatic archiving. Leave this add-on unselected when using that behavior. Checkout and order listing/detail work independently. Without the add-on, composition omits the workflow runtime, event endpoint, workflow checkpoints and order-email implementation. Select it when the application needs custom order processing, such as coordinating an external system. The included implementation sends confirmation and shipped emails and archives paid, fulfilled orders; customize that behavior for the project's requirements and coordinate native notifications before enabling it.

The order-created event starts a single Workflow SDK run. The atomic start token is derived from the Order ID. The receiver accepts creation events for Orders in configured Stores for seven days from native creation. The SDK retains the token for at least seven days after admission, including after the run ends. This covers redeliveries throughout the entire admission window. Keep the same Workflow storage across deployments.

Workflow records each operation as a separate step. It reads native Order state, prepares and sends the confirmation, reconciles immediate payment, waits for full shipment, prepares and sends the shipped notice, waits for deferred settlement when necessary, then closes the Order. The fulfillment hook can receive updates as soon as the run is admitted. The payment hook opens for a pending immediate payment or for a shipped Order on payment terms that still needs to settle. The workflow registers it before checking payment so it sees settlement recorded before the hook opened. Fulfillment, payment, and cancellation events wake the relevant hook, and the workflow reads current native state. If delivery is missed, an operator can resume the active hook with `resumeHook(token, null)` from a trusted server context. Step retries handle failures such as a temporary provider outage.

An update can wake a run or ask the sender to retry if creation is still pending. A run that has been admitted can read payment already recorded at the provider even when it has no active payment hook. An update for an Order that is closed, cancelled, outside the managed Stores or outside the creation window can be acknowledged when there is no active run.

Workflow keeps the run ID, step outcomes, retries, and prepared email data. The Order retains its native payment, shipment, and closure state. Resend receives a stable key for each Order and notice kind, so a lost send response can be retried with the same prepared input. The send step stops before Resend's 24-hour deduplication window expires. A failed run is visible in Workflow. Reconcile any uncertain external effects before manually restarting an Order. Creation redelivery leaves an existing run in place, including a failed run.

The workflow attempts one shipped notice after the provider records the whole Order fulfilled or shipped. If preparation or delivery of either email fails, the failed step remains visible in Workflow history and the Order continues processing. Email goes to the Order's recorded recipient. Personal Order emails can include an [email-authorized detail link](email-access.md). Set `COMMERCE_ORDER_ACCESS_SECRET` and `NEXT_PUBLIC_WEB_URL` for those links. The preparation step saves the link as part of its output so a send retry uses the same URL.

Drain existing order workflow runs before switching the webhook receiver to this implementation. The replacement has new hook tokens and step boundaries. The installed Workflow host must support atomic start hooks and retention.

## Runtime configuration

Set `RESEND_TOKEN` and a verified `RESEND_FROM` in the workflow host: API for commercetools, web for Shopify. The selected provider also needs privileged Order credentials. No live email or native order state is changed during composition.

### Shopify

The following configuration applies only when the custom workflow add-on is selected.

Set `SHOPIFY_ORDER_WEBHOOK_SECRET` to the signing app's client secret and `SHOPIFY_STORE_DOMAIN` to the matching shop. Configure that app's HTTPS webhook subscriptions to `/api/commerce/order-events` for `orders/create`, `orders/paid`, `orders/fulfilled`, `orders/partially_fulfilled`, `orders/cancelled`, `fulfillments/create` and `fulfillments/update`. `orders/create` starts the run. Fulfillment and cancellation wake the fulfillment hook. `orders/paid` and cancellation wake an open payment hook for either payment mode. Do not subscribe `orders/updated` for this workflow: checkpoint metafield writes would cause unnecessary wakeups. The receiver checks raw-body HMAC, shop domain and topic. Order topics identify the Order by `admin_graphql_api_id`; fulfillment topics use their owning `order_id`. All state and recipients are reread through the Admin API.

Admin access needs `write_orders`, `read_all_orders` for long-running payment terms, protected customer-data approval for email and purchased details, and Order metafield access. Run project/catalog provisioning first so Store attribution copies from Cart to Order. Coordinate native Shopify confirmation/shipping notifications with these application emails to avoid duplicate customer messages. The recipe does not modify Shopify notification settings.

Closing uses `orderClose` after rereading fulfillment and payment. Shopify remains authoritative for its native lifecycle and any subsequent order edits.

### Commercetools

Commercetools hosts the workflow in the API application, independently of company registration. Its order/payment consumer joins the independent `/webhooks/commercetools` API receiver. The optional `commerce-commercetools-connect-proxy` add-on deploys a hosted sender; consumer installation does not depend on it. Follow [Connect proxy setup](../../commerce-commercetools/connect-proxy/README.md) when selected.

The repository supplies no other queue relay. If you supply your own queue consumer and HTTP forwarder, set `COMMERCETOOLS_ORDER_EVENTS_SECRET` to its strong shared secret. Configure a native Subscription in `Platform` format with your queue destination and the Order/Payment Message types listed in [Connect proxy setup](../../commerce-commercetools/connect-proxy/README.md). Its consumer forwards native Message deliveries unchanged to the API application’s `/api/commerce/order-events` receiver with `Authorization: Bearer <secret>`. The receiver checks the configured project and Order/Payment resource type, acknowledges native Subscription probes, and accepts documented payload-truncation metadata for large orders without needing the message body. This is a queue relay endpoint; commercetools Subscriptions do not deliver directly to arbitrary HTTP endpoints. Queue/cloud infrastructure is deployment-owned.

The API needs `view_orders`, `manage_orders` and `view_payments` for Order and Payment operations. `OrderCreated` starts the run. Payment transaction messages locate Orders that reference the Payment. Payment updates can wake a payment wait. Shipment, parcel and delivery updates can wake a fulfillment wait. Order edits and cancellation wake either wait.

Payment reconciliation and closure each read the current Order with its linked Payments. For checkout card orders, successful charges minus successful refunds must cover the current gross payable total in the Order's currency. A previous `Paid` flag can outlast an Order Edit or refund. Net Terms orders use the explicit native Paid state when funds are collected. Closing changes native `orderState` to `Complete` with the version read during that step, after shipment and settlement are verified. Preparing an email reads the Order, and the send step reuses that prepared notice for delivery retries. Inventory reservation, capture, invoicing and fulfillment execution remain their respective providers' responsibilities.

## Verification

Source tests exercise provider reads, settlement, close, and event routing. Run `pnpm --filter @repo/commerce-core test:workflow` from the source checkout to exercise atomic admission, hook delivery, and step retries with the local Workflow runtime. Live provider delivery and email still need a sandbox Order.

References: [Workflow hooks](https://workflow-sdk.dev/docs/foundations/hooks), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [commercetools Subscription payloads](https://docs.commercetools.com/api/projects/subscriptions#messagedeliverypayload), [Shopify orderClose](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderClose).
