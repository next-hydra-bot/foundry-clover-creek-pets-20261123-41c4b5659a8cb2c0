# Optional merchant fulfillment

Select `commerce-fulfillment-admin` for the commercetools packing/shipping screen at `/fulfillment` in Admin. It installs `commerce-fulfillment-api` as well. Select only `commerce-fulfillment-api` when another client will supply the UI. Both are independent of buying flavor, registration, custom/hosted checkout, the Order workflow and Connect. No new package or separate preparation store is needed.

Shopify stays on its native fulfillment UI. Its signed fulfillment/payment webhooks continue to wake the optional Order workflow. This slice does not install a Shopify fulfillment screen or adapter.

## Ownership and setup

Commerce Core owns the schemas, OrderFulfillment Effect capability, permissions, HTTP contract and Admin presentation. Commercetools supplies native Order reads/updates. Recipes install one HTTP route into the storefront and one page into the Admin host; provider SDK calls and forms remain in packages. The merchant API has separate authentication from the storefront's customer APIs.

- In `apps/web`, configure the existing commercetools runtime credentials with `view_orders` and `manage_orders`.
- Also configure the **Admin** identity application's verifier: the selected provider's `ADMIN_WORKOS_*` or `ADMIN_CLERK_*` credentials. These are independent of the customer identity pool. Follow the auth provider's Admin verifier instructions, including issuer/audience/authorized-party configuration.
- In `apps/admin`, configure the same isolated Admin identity application and set `FULFILLMENT_API_URL=https://<storefront>/api/commerce/fulfillment`.
- Grant operators `fulfillment.read` and/or `fulfillment.manage` in that Admin identity application's permissions. Reads and mutations enforce their own permission. Navigation is presentation only. The Admin manifest receives only this screen's declared permissions; storefront permissions are unchanged.

The API is hosted in the existing storefront server so API-only compositions do not acquire a separate backend application or registration infrastructure. It uses bearer authentication; it does not accept the storefront cookie as merchant authority.

The lower-level `commerce-commercetools-fulfillment` recipe installs native reads/updates and exports `commercetoolsFulfillmentLayer` from `@repo/commerce-provider/fulfillment`. It installs no HTTP route. A different host can compose it with `commerce-fulfillment-http`, provide its own `FulfillmentAuthentication` Layer, and mount `makeFulfillmentHttpHandler`. The default `commerce-commercetools-fulfillment-api` recipe adds the Admin verifier and storefront route to those capabilities.

## HTTP contract

All paths below are relative to `FULFILLMENT_API_URL` and require `Authorization: Bearer <verified merchant token>`.

| Operation | Endpoint | Permission |
| --- | --- | --- |
| Pending Orders | `GET /orders?limit=20&after=<cursor>&orderNumber=<exact-number>` | `fulfillment.read` |
| Fulfillment detail | `GET /orders/:id?locale=en-US` | `fulfillment.read` |
| Pack Delivery | `POST /orders/:id/deliveries?locale=en-US` | `fulfillment.manage` |
| Ship Parcel | `POST /orders/:id/parcels?locale=en-US` | `fulfillment.manage` |

Packing submits `{ revision, groupId, items: [{ lineItemId, quantity }] }`. Shipping submits `{ revision, deliveryId, items: [{ lineItemId, quantity }], tracking?: { carrier?, number? } }`. All IDs and revisions are opaque to callers. The API validates positive, safe integer quantities, unique selected lines, current revision and remaining allocations. Partial quantities are supported. This screen records shipments; it does not buy labels or book carriers.

Packing creates a native Delivery with a copy of the selected shipping group's destination; the screen displays that recorded Delivery address even if the Order's shipping address subsequently changes. Shipping creates a native Parcel with explicit item quantities. Progress is derived from those native records. The adapter counts normal and custom Order lines and preserves native multiple-shipping groups. A Parcel and computed `Partial`/`Shipped` Order state are saved in one version-checked update. This convention treats Parcel creation as the shipment event; do not create a Parcel merely to reserve packing progress.

Native commercetools does not enforce cumulative quantities, so the adapter checks remaining quantities before the versioned write. Stale revisions/concurrent writes return 409 and require refresh. A lost write response returns `fulfillment.outcomeUnknown` with refresh guidance; do not blindly replay additive quantities. The SDK can retry a versioned request using the same version, which prevents duplicate application after an accepted write.

Externally created Parcels must carry item quantities. The screen refuses to guess which lines they contain. Single-shipping Orders with multiple item-address targets currently require native multiple-shipping grouping before this screen can manage them; unsupported allocations fail before a write. Existing shipment records and their quantities remain visible through the provider's native tools.

## Workflow continuation

Shipping does not call Workflow SDK directly. The update emits native `ParcelAddedToDelivery` and `OrderShipmentStateChanged` Messages. When the optional Order workflow is installed, configure its [event source](../orders/README.md), either the optional Connect proxy or a deployment-owned queue relay. That receiver verifies the delivery and resumes the existing durable hook. Shipment and deferred payment remain separate facts; shipping a Net Terms Order does not mark it paid.

## Future Merchant Center app

A Merchant Center app can call these same JSON endpoints through `/proxy/forward-to`, setting the HTTPS `X-Forward-To` target, `Accept-version: v2`, `X-Project-Key`, audience policy and `X-Forward-To-Claims: permissions`. Merchant Center forwards its own signed exchange JWT; it is not a Clerk/WorkOS token. The proxy is server-to-server, so this path does not depend on browser CORS or Admin cookies. See [the official external API integration guide](https://docs.commercetools.com/merchant-center-customizations/concepts/integrate-with-your-own-api).

The `FulfillmentAuthentication` Effect seam receives the bearer token plus raw request headers and URL. A future recipe can provide a Merchant Center adapter, or an explicitly configured adapter that accepts both identity systems. It must use the official `createSessionAuthVerifier` or equivalent signature/issuer/audience/JWKS verification, validate the **signed** Project key against the configured connector Project, and map exact configured Custom Application View/Manage permissions to `fulfillment.read`/`fulfillment.manage`. Do not authorize from forwarded headers, decoded JWT contents, or Project membership alone. [Merchant Center permissions](https://docs.commercetools.com/merchant-center-customizations/concepts/oauth-scopes-and-user-permissions).

Its recipe should depend on `commerce-commercetools-fulfillment` and `commerce-fulfillment-http`, then supply its own route composing that authentication Layer with `commercetoolsFulfillmentLayer` and `makeFulfillmentHttpHandler`. The default Admin route is a separate recipe and is not required. Fulfillment commands, responses and paths remain unchanged. No Merchant Center frontend, exchange-token verifier or broad role-name mapping is included in this slice. The default route accepts only tokens verified against the configured Admin identity application.
