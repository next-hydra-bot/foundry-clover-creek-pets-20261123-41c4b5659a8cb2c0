# @repo/commerce-commercetools

The Commercetools implementation of the provider-neutral Services owned by `@repo/commerce-core`, plus Commercetools administration tooling. Provider code depends on the contracts; the application selects storefront, buying-context and checkout packages.

Applications import only the package's explicit capability Layers, environment keys, or CLI command factory. REST and GraphQL clients, provider queries, resource versions, schema assets, migrations, and generators are private implementation details.

Public product data and SEO metadata use the `hours` remote-cache profile as a fallback because Product Search is eventually consistent. Categories use long-lived remote caches. Public catalog refills read current Store/channel configuration directly instead of reusing the request adapter’s Store cache. Configure the signed Connect Proxy catalog receiver as a required setup step: [catalog cache invalidation](webhooks/README.md#catalog-invalidation). The official Connect CLI registers/publishes the Connector; `commerce connect deploy` deploys a published proxy with Connect-managed credentials; supply the receiver endpoint and matching webhook secret, with no local proxy credentials file. This is separate from Algolia ingestion and the optional Order workflow. Authenticated customer/company pricing remains request-bound.

Catalog cache invalidation is available through the `commerce-commercetools-catalog-events` add-on, which installs the separate API receiver. The Connect proxy add-on also installs it. A B2C workspace using only the storefront checkout or storefront HTTP routes can run without that separate API application.

## Configuration

Copy `.env.example` into the application or command environment and provide all five server-only values:

```bash
COMMERCETOOLS_PROJECT_KEY=your-project-key
COMMERCETOOLS_CLIENT_ID=your-client-id
COMMERCETOOLS_CLIENT_SECRET=your-client-secret
COMMERCETOOLS_SCOPE=manage_project:your-project-key
COMMERCETOOLS_REGION=us-central1.gcp
```

Application T3 Env roots extend `@repo/commerce-commercetools/keys` for eager startup validation. Provider Layers use `CommercetoolsConfig.layer` to validate the same contract when their Effect graph is constructed.

Web and API import their application environment from `next.config.ts`, so the T3 Env contract is evaluated during `next dev` and `next build` rather than on the first commerce request. The CLI validates the same contract after loading its command environment.

## Supported exports

- `provider` selects the named Web capability Layers.
- `cart`, `commerce-accounts`, `address-book`, and `product` provide individual commerce capability Layers.
- `versioned-store` and `registration` provide application composition Layers.
- `config` and `keys` expose the provider configuration contracts.
- `cli` exposes the `commerce` administration command factory.

Raw clients, schemas, migrations, and generators are intentionally not package exports.

## Order history

B2C and B2B storefront recipes install `/[locale]/account/orders` and `/[locale]/account/orders/[id]` for custom and hosted checkout. The legacy blended assembly dispatches through its verified purchasing context. Listing defaults to all Stores; `?store=<Store key>` selects an explicit native Store without changing presentation locale. Each order retains its recorded currency.

Native shipment states populate the Order status, including partially fulfilled Orders. A fully Shipped or Delivered Order establishes the corresponding state for its Delivery records; ambiguous per-Delivery states remain unknown. Return Parcel tracking is excluded from outbound shipments. Native TrackingData has carrier and tracking ID but no tracking URL, so the adapter retains those values without constructing carrier links.

Order detail reads the recorded net merchandise subtotal, net shipping and tax when native tax totals are available, including multiple shipping methods and total-price discount allocation. Product, cart, shipping and total-price discount amounts are informational observations; the native Order total stays authoritative. Expanded Order Payments supply successful Charge and Refund amounts. Missing Payment expansions leave those observations unknown; refunds do not create a newly inferred debt. Payment references expand using the Order's read scope, without an additional Payment read scope ([Reference Expansion](https://docs.commercetools.com/api/general-concepts#reference-expansion)). Imported Orders without enough allocation information omit the affected optional breakdown rather than fabricating one.

The `orders/queries` Layer uses the existing project REST client with `view_orders` (or `manage_orders`). B2C reads the verified Customer's personal orders, excluding orders attached to a Business Unit. B2B reads the selected Business Unit's shared order pool after the domain verifies `company.orders.read` for that Business Unit. Project credentials do not establish the buyer's permission; the application checks it before calling the provider. Default onboarding grants this permission to company buyers and administrators.

Listing uses stable descending creation-time/ID pagination. Detail reads verify ownership and the explicit Store filter, use historical line items and addresses, and do not require a current Cart, catalog Product, payment reference or custom-checkout session. The read capability is separate from `Orders`, which still owns order placement and recovery.

## Schema and migration tooling

Run the commands from the installed workspace root. pnpm runs the CLI in `apps/cli`, so relative environment-file and output paths below resolve there:

```bash
pnpm --filter cli cli --env-file .env.bootstrap.local commerce project provision --output .env.runtime.local
pnpm --filter cli cli --env-file .env.runtime.local commerce project seed
pnpm --filter cli cli commerce schema export
pnpm --filter cli cli commerce types generate
pnpm --filter cli cli commerce migrate plan
pnpm --filter cli cli commerce migrate
```

Project provisioning reads a manually-created bootstrap API Client from the standard `CTP_*` variables, including its auth/API URLs and scopes. It verifies the client can manage project settings and API clients, activates Product Search, waits for indexing readiness, creates the application runtime scopes (including `view_published_products`), applies pending migrations, and publishes the application's `COMMERCETOOLS_*` runtime credentials before deleting the bootstrap client. The default local store exclusively creates and verifies a new `0600` dotenv file; existing files are never overwritten. `--store vercel` publishes to every required linked application project after checking all links, selected environments, access, and key conflicts. Existing assignments fail by default; `--overwrite` explicitly upserts only the exact runtime manifest in the selected targets, which supports replacing an expired demo without touching unrelated variables. Vercel publication requires a new deployment. Ambiguous overwrite responses are retried in-process with the same values. After a partial or unknown publication failure, the runtime client is preserved because a Vercel project may reference it; a fresh `--overwrite` provisioning run creates replacement credentials and converges every selected target, potentially leaving the earlier client for manual cleanup.

Pass `--keep-bootstrap-client` to keep the original API Client active for catalog setup and cleanup. The command still creates and publishes a separate runtime client with the application scopes. Keep the original `CTP_*` environment file private for future provisioning.

Schema export writes raw Product Types and Custom Types under `schema/`. Type generation writes provider-private Custom Field helpers under `custom-fields/` from native Custom Types. Product Attributes are generated from Core’s provider-neutral `catalog/product-model.json` into `packages/commerce-core/product/generated/attributes.ts`; catalog imports map that same JSON model into native Product Types. See the [custom model and catalog workflow](../commerce-core/catalog/README.md#agent-authored-product-models-and-catalogs).

Migrations and their tracking implementation live under `migrations/`; see [`migrations/README.md`](migrations/README.md) for the operational workflow.

Synchronize the provider GraphQL schema and gql.tada declarations with:

```bash
pnpm --filter @repo/commerce-commercetools generate
```

## Clean up a sample project

The commercetools recipe installs `commerce cleanup` for both B2B and B2C. Use a dedicated API Client for the project being cleaned. Put its standard `CTP_*` settings in an operator-owned environment file. The API Client needs read access for a dry run and manage access for deletion. `manage_project:<projectKey>` covers the project resources targeted by the command.

Use `--dry-run` to list what each command would delete.

```sh
pnpm --filter cli cli --env-file "$PWD/.env.cleanup.local" \
  commerce cleanup all --dry-run

pnpm --filter cli cli --env-file "$PWD/.env.cleanup.local" \
  commerce cleanup custom-objects --custom-object-container demo-data --dry-run
```

Omit `--dry-run` to confirm deletion interactively. The prompt shows the selected scope and project and defaults to No. Use `--yes` to authorize deletion from a script. When both flags are present, the dry run takes precedence.

The `all` subcommand selects every supported project resource type, including Stores, Channels, Shipping Methods, Zones, Tax Categories, and Custom Types. Use a subcommand such as `products` or `stores` to select one resource type. Custom Objects are listed by container. Pass `--custom-object-container` once per container to include those objects in `all` or to clean those containers on their own with `custom-objects`.

Cleanup removes Carts before Orders and clears both before Business Units and Customers. It deletes Shipping Methods before their Stores, Zones, and Tax Categories, and Stores before their Channels. [Channel deletion order](https://docs.commercetools.com/api/project-configuration-apis-overview#delete-channels) · [Business Unit deletion](https://docs.commercetools.com/api/projects/business-units#delete-businessunit)

Use `--where` for one resource or container, and `--limit` to cap entries per target. A dry run prints counts and up to 20 identifiers per target. Cleanup unpublishes Products and removes their Product Selection memberships as needed. Deleting a Product Selection removes its assignments from Stores. Business Unit divisions and Categories are processed before their parents. A Category with remaining children is skipped with an error to prevent a cascade.

A version conflict or other failed deletion stops the command after the current resource, with a nonzero exit and a summary. Earlier deletions can already have succeeded. Resolve the failure and run with `--dry-run` again before retrying deletion. If you previously imported the catalog into the same project, use the importer's `--update` option to reprocess its successful local migration records after deleting their remote products.

## Customer accounts

The `customerProfilesLayer` capability creates externally authenticated Customers or updates the Customer already linked to the same authentication identity. Email alone cannot claim an existing Customer. New Customers registered for B2C purchasing are created without a Business Unit or an email-verification assertion.

The Address Book capability resolves Customer ownership for B2C principals and the existing associate/Business Unit scope for company principals. Both use canonical address references and versioned write reconciliation. B2C enrollment is stored in the `customer-personal-accounts` Custom Object container (the existing runtime custom-object scopes cover it); no Custom Type migration is required. This enrollment prevents company-member retirement from deleting a Customer that is also enrolled for B2C purchasing.

## Validation

```bash
pnpm --filter @repo/commerce-commercetools typecheck
pnpm --filter @repo/commerce-commercetools test
pnpm boundaries
```

Unit tests exclude the registration live suite. With the required provider credentials supplied to the process, run it separately:

```sh
pnpm exec turbo run test:live --filter=@repo/commerce-commercetools
```

The live task enables `COMMERCETOOLS_LIVE_TESTS=1` and disables Turbo caching so each invocation exercises the provider. It is separate from application build dependencies. The repository boundary task runs Biome to restrict imports of this package to application environment, Layer-composition, and CLI tooling roots, then checks which package manifests may declare the provider dependency.

### Browser fixture composition

The provider owns `commerce-commercetools-company-checkout-e2e`. Explicit selections include it only for B2B, custom checkout, standalone Admin and the checkout HTTP API. It composes the domain-owned company, registration and checkout scenario recipes with native Commercetools/Stripe setup and cleanup. B2C, hosted checkout, Shopify and Merchant Center do not receive this fixture.

## Required checkout choice

New compositions select `commerce.purchasing` and `commerce.checkout` through recipes. B2B additionally selects `administration.host=admin` or `administration.host=merchant-center`. The host choice is shared by installed administration features. Registration adds approvals automatically; the optional `customer-impersonation` add-on adds impersonation to that same host, including for B2C. Both review hosts install the same Registration API and Workflow SDK workflow; Merchant Center supplies the reviewer through its signed gateway token instead of an isolated Clerk/WorkOS Admin identity. The Merchant Center choice installs `apps/ct-admin`, omits standalone Admin, and requires a public HTTPS Registration API endpoint. See [Merchant Center setup](../../apps/ct-admin/README.md) and the [runnable proof workspace](../../workspaces/commercetools-merchant-center/README.md). Legacy selections without `recipes` retain their existing standalone Admin host. The add-on descriptions below describe those legacy selections.

Every Commercetools storefront includes exactly one checkout implementation. The default assembly installs our custom checkout. Selecting `commerce-commercetools-checkout` in `addOns` replaces it with Commercetools-hosted Complete Checkout for B2C and guests. These alternatives are mutually exclusive; omitting that selection keeps custom checkout installed. The current selection format represents the hosted replacement through `addOns`.

The HTTP API is a separate, optional selection: `commerce-commercetools-api` works with either checkout implementation. It exposes cart, catalog, Orders and `GET /api/commerce/address-book`. Address-book requests require a verified site bearer token, `X-Context-Locale`, and either `X-Context-Purchasing-Context: personal` or `company` plus `X-Context-Business-Unit-Id`. The server verifies the selected membership; it does not infer a company from an omitted selector. Address and Order reads do not initialize a Cart. Selecting or omitting that API add-on does not change the checkout choice.

Custom checkout and the purchasing experience are composed separately. Existing selections keep the complete storefront by default. These public `addOns` select smaller assemblies using the same checkout workflow:

| Selection | Installed experience |
| --- | --- |
| `commerce-commercetools-b2c` | Guest/customer shopping, customer registration and account, custom checkout and Stripe cards. No company workflows, account-credit store, API app or Admin app. |
| `commerce-commercetools-b2b` | Company purchasing, account/member management, invitations, native delivery and custom checkout with cards/Net Terms. No company self-registration or approval apps. |
| `commerce-commercetools-company-registration` | Selects B2B and adds company self-registration, approval workflow, API app and Admin app. Its registration API environment does not require Stripe credentials. |
| `commerce-commercetools-checkout-api` | Optional custom-checkout HTTP routes in the web app, without the separate API/Admin applications. Requires custom checkout. |
| `commerce-commercetools-complete` | Explicitly selects the existing blended B2C/B2B storefront with registration, approval, Admin and backend checkout/address-book/cart/catalog APIs. This remains the default when none of the other purchasing or hosted-checkout selections is supplied. |

B2C, B2B and complete custom assemblies are mutually exclusive. The hosted-checkout selection replaces these custom assemblies. The cart/catalog API add-on can accompany any supported purchasing assembly; it adds web routes without installing the separate API app. For custom checkout, add `commerce-commercetools-checkout-api` to expose `/api/checkout/*`, with its schema at `/api/checkout/openapi.json`. It reuses the same checkout workflow and authenticated buyer-context checks. Authenticated B2C API requests send `x-context-purchasing-context: personal` plus their bearer token and locale; company requests send their selected Business Unit. The server derives the Store from locale and verifies access. Hosted checkout does not support these custom-checkout endpoints.

Company self-registration and standalone Admin use `API_INTERNAL_URL` when Vercel provides a binding, with `NEXT_PUBLIC_API_URL` as the fallback for separate deployments. Merchant Center requires the same public HTTPS API origin in `NEXT_PUBLIC_API_URL` on ct-admin and API. The cached catalog installs the API webhook receiver independently of registration or Connect hosting. Configure its receiver and API-to-web handoff as described in [event setup](webhooks/README.md). Custom Order workflows use that API host. Optional storefront HTTP routes remain on the web origin.

For example, a B2C custom storefront uses:

```json
{
  "providers": {
    "cms": "contentstack",
    "auth": "clerk",
    "commerce": "commercetools"
  },
  "addOns": ["commerce-commercetools-b2c"]
}
```

Use `commerce-commercetools-b2b` for an existing-company storefront, or `commerce-commercetools-company-registration` when customers should apply for company access. Both Clerk and WorkOS are supported. Vercel credential provisioning targets the composed web and API applications; the catalog webhook recipe installs API independently of company approval. For B2B without registration, configure the selected identity provider’s signed invitation webhook at the web app’s `/api/webhooks/clerk` or `/api/webhooks/workos` route and supply its webhook secret. Adding company registration moves that webhook to the approval API application, using the existing registration setup. These recipes assemble existing packages; no new package or composition-engine extension is required. Account and request templates are package-owned, and the emitted application retains its concrete provider bindings.

Hosted sessions, SDK UI and verified receipts live in `checkout/`; application templates select the provider Layers. See [configuration and behavior](checkout/README.md).

## Company account details and approval policies

The shared B2B account route `/[locale]/account/company` uses `companyProfilesLayer`. It reads the selected Business Unit through the verified Associate context. Administrators can change its name, contact phone and default billing/shipping addresses. Phone is stored with the default addresses. Existing address/contact fields and unrelated saved addresses are preserved. Legacy native street numbers are combined with the street name on read; saves put the complete line into `streetName` and clear `streetNumber`; a shared default address is split when billing and shipping are edited differently. A provider revision binds both Business Unit ID and native version. Updates use the native version and never retry a stale edit automatically.

Optional company-registration approval choices use `COMMERCETOOLS_COMPANY_PURCHASING_POLICIES`, a JSON array with these fields. This configures the reviewer’s choices of Store, currency and Customer Group for a newly approved company; it is not a storefront pricing database and is not required for search or shopping:

```json
[
  {
    "key": "gold-earthworks",
    "label": "Gold dealers / Earthworks",
    "storeKey": "default-store",
    "locale": "en-US",
    "currency": "USD",
    "pricingGroupKey": "gold-dealers",
    "customerGroupId": "replace-with-native-customer-group-id"
  }
]
```

Use an explicit Core Store and native Customer Group ID. Approval validates the Store and group, preserves the company's other Stores, and writes native Business Unit `customerGroupAssignments`. Existing conflicting assignments require explicit reconciliation. Employees' Customer Groups remain unchanged. The Store has one shared distribution channel; group-specific embedded prices carry the native Customer Group reference. No custom pricing record or per-company sales channel is required.

Product discovery uses native Product Search with `variants.stores`, `markMatchingVariants` and `allVariants(onlyMatching: true)`. The Store controls the public market assortment. Product reads pass the selected Business Unit's Customer Group IDs into native price selection; Cart uses its native Business Unit association. Unset assignments inherit customer pricing, while an empty array disables group pricing. Native assignments are a commercetools beta feature, accessed through the official SDK's GraphQL endpoint where the installed REST SDK lacks types. Company Registration persists the reviewer's selected pricing group, Store, locale and currency. Onboarding assigns the policy before its final initial-member access grant; retries reconcile native state and reject changed buying terms rather than selecting a fallback. No sandbox was used to validate the HTTP fixtures.

Stores use one common sales channel for consumer and company shopping. Fresh catalog provisioning creates native Customer Groups and assigns them to Business Units. See [catalog setup](catalog/README.md#company-assortments-and-fixed-prices) and [Algolia setup](../search-algolia/connector/commercetools/README.md).

## Commerce HTTP API

Select the optional `commerce-commercetools-api` add-on to install cart, catalog and Order HTTP routes at the storefront origin under `/api/commerce`, with OpenAPI at `/api/commerce/openapi.json`. It works with either custom checkout or Commercetools hosted Checkout. For hosted B2C, select both add-ons:

```json
{
  "providers": {
    "cms": "contentstack",
    "auth": "clerk",
    "commerce": "commercetools"
  },
  "addOns": ["commerce-commercetools-checkout", "commerce-commercetools-api"]
}
```

WorkOS is also supported. The add-on reuses `CommerceBaseApp` from the selected storefront runtime, including its purchasing context and cart implementation. Hosted B2C therefore uses the same single-shipping carts in HTTP and web shopping. It does not install the custom checkout workflow, Stripe, company administration or a separate API application. Checkout completion remains with the selected checkout implementation; this add-on exposes cart, catalog and Order read operations.

The existing custom checkout assembly retains its separate API application and its `/cart`, `/products` and `/orders` routes through the provider-owned internal `commerce-commercetools-api-backend` recipe. Both hosts use the same package-owned handlers and Core contracts/programs. Application routes remain thin bindings. The following paths are relative to `/api/commerce` for the optional storefront add-on, or to the separate API origin for the existing backend:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/cart` | Current public cart state, or `null` |
| POST | `/cart/items` | Add `{ variantId, quantity }` using the opaque Product Detail variant reference |
| PATCH | `/cart/items` | Set `{ lineItemId, quantity }` |
| DELETE | `/cart/items` | Remove `{ lineItemId }` |
| GET | `/products` | Product cards; optional `categoryId`, `excludeProductId`, `limit` (1–100) |
| GET | `/products/:slug` | Product Detail or `null` |
| GET | `/orders?allStores=true` | Authorized personal or selected-company history |
| GET | `/orders/:id?storeKey=...` | Authorized Order detail |

Every request supplies `X-Context-Locale`; shopping Store and currency derive from its configured default mapping. Authenticated requests use the selected Auth Provider's bearer token, plus `X-Context-Purchasing-Context: personal` for B2C or `company` with `X-Context-Business-Unit-Id` for B2B. Shopping company access is verified through the composed buying context. Order reads verify direct or inherited membership for the selected Business Unit independently of the locale-derived shopping Store, then apply the explicit historical Store selection and `company.orders.read` permission. An invalid bearer never falls back to guest purchasing.

Guests retain the returned HTTP-only `cart` cookie in a cookie jar. Authenticated cart selection uses verified Customer or Business Unit ownership and ignores guest cart credentials. Cart, catalog and checkout operate on the same current cart. Catalog reads do not create carts. An uncertain write returns `CartWriteOutcomeUnknown`; retain the cookie and refresh before deciding whether to repeat a mutation. Each host’s OpenAPI document includes its installed routes and path prefix.

Order reads require a bearer token and `view_orders` (or `manage_orders`) on the integration credentials. Company reads also require a role granting `company.orders.read` in the verified subject's signed `app_roles` claim for the selected Business Unit. History explicitly selects `allStores=true` or `storeKey`, independently of locale. It retains each Order's original currency and does not touch carts. Filters, pagination, error responses and request examples are documented in [Core's HTTP contract](../commerce-core/http/README.md). Order HTTP reads do not require the optional Order workflow.

## Explicit purchasing and checkout recipes

New compositions use `recipes: { "commerce.purchasing": ["b2c"], "commerce.checkout": ["custom"] }` in their workspace definition, or repeat `--recipe commerce.purchasing=b2c --recipe commerce.checkout=custom` during creation. Choose exactly one purchasing context. B2C supports custom or hosted checkout; B2B currently supports custom checkout only. Hosted and custom checkout are exclusive.

The `commercetools-b2c` workspace exercises custom checkout without company registration or Admin. The `commercetools-b2b` workspace automatically includes company registration/approval and its API/Admin applications. The `commercetools-hosted` workspace exercises hosted B2C. Commerce HTTP APIs remain optional. The former company-registration Add-on remains accepted as a compatibility alias and is omitted from new prompts.

The replacement Add-on examples above remain legacy-compatible. Definitions that omit `recipes` retain their existing assembly, including blended storefronts. Explicit legacy Add-on CLI flags also retain their previous behavior when no `--recipe` flags are supplied, and print migration guidance. New interactive menus use the required recipe groups.

## Tax and payable totals

Custom checkout prepares, authorizes and finalizes payment using native `taxedPrice.totalGross`. Native tax categories, rates and shipping tax configuration must be configured in commercetools for Platform tax calculation. Unresolved tax blocks payment; it is never treated as zero. Explicit `TaxMode.Disabled` represents a known zero-tax setup. The cart and checkout display native tax amounts and identify tax-inclusive prices; order confirmation and recovery retain the same gross total. Hosted checkout confirmation also reads the native gross total.

## Promotions

Configure native Product Discounts, Cart Discounts and Discount Codes in commercetools. The adapter reads Product `discounted.value` for effective prices and preserves the original price for Product Card/Detail comparisons. Cart code actions use native `addDiscountCode` and `removeDiscountCode` updates on the verified buyer's current Cart/version. A promotion change clears prepared Payment and selected Delivery Plan state so checkout prepares fresh amounts. Native per-quantity allocations, total-price discounts and shipping discounts are projected for the shared Cart page, flyout and custom checkout summary; provider totals remain authoritative. The optional Commerce HTTP API exposes the same code mutation. Native pricing selection still controls B2B Customer Group eligibility.

Reading a selected Cart also reconciles references to deleted Discount Codes after verifying ownership. The adapter removes those native references, clears prepared Payment and Delivery Plan selections, then reloads native totals. Existing inactive or expired codes remain visible and removable. A concurrent cleanup is verified with a fresh read; stale writes are not replayed.

Re-run search provisioning to deploy the updated transformation and rebuild reference prices. Search numeric prices and sort replicas use `discountedValue` when present, separately for public and Customer Group audiences. Cart-only discounts and codes are evaluated on the Cart, not forecast into catalog sorting.

### Optional tax provisioning

`commerce data setup --taxes <catalog-tax.json> --tax-config <provider-tax.json>` applies shared Product classifications through this provider. B2B and B2C use the same flags. See [tax setup](../commerce-core/provisioning/README.md#tax-setup) for the command, native capabilities, provisioning scopes and examples in `provisioning/tax-config.example.json`.
