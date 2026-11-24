# Browser tests

This package runs the application's end-to-end tests. It discovers BDD scenarios and steps under `packages/*/e2e/` and `tests/e2e/features/`. It also runs ordinary Playwright `*.spec.ts` files under `tests/e2e/`. Domain packages own their scenarios and drivers. Scenario recipes are selected with their matching fixture composition; installing a domain package alone does not install checkout or company-registration scenarios. `composition.ts` selects the fixtures installed with this application; `global.setup.ts` checks the selected applications and initializes any selected authentication support.

From the project root:

```sh
pnpm --filter @repo/e2e exec playwright install chromium
pnpm dev
pnpm test:e2e
```

List available tests without running them:

```sh
pnpm test:e2e:list
```

Pass Playwright options after the separator, for example:

```sh
pnpm test:e2e -- --grep 'Anonymous checkout' --workers=1
```

A project with no selected scenarios reports zero tests; it does not establish browser coverage. The runner accepts an empty suite so applications can adopt scenarios incrementally. Use `pnpm --filter @repo/e2e exec playwright test` without `--pass-with-no-tests` when CI must reject an empty selection. The Drupal composition supplies CMS browser scenarios. Add tests for your own application's content and behavior.

## Applications and environments

Local runs reuse the applications started with `pnpm dev`. Portless names come from each application's own package manifest. Web is required; API and admin are used only when installed. The runner reads each selected application's normal `.env` files and keeps customer and admin authentication credentials separate.

`E2E_WEB_URL`, `E2E_API_URL`, and `E2E_ADMIN_URL` override the corresponding origins. Only installed applications need URLs. With all selected URLs supplied, tests target those existing deployments. In CI without complete overrides, Playwright starts the remaining selected applications directly. A web-only project therefore needs only `E2E_WEB_URL` to target an existing deployment.

Authentication and commerce fixtures use real providers. Configure isolated test tenants and the same provider selection as the application under test. For deployed runs, supply credentials needed for fixture provisioning and cleanup to the test process; admin credentials use `ADMIN_WORKOS_*` or `ADMIN_CLERK_*` names. `E2E_RUN_ID` optionally identifies resources created by the run. Storefront fixtures clean up scenario-owned identities, companies, carts, payments and orders.

## Authoring

Keep feature wording about application behavior, step bindings thin, and browser selectors/assertions in domain drivers. Import BDD bindings from `@repo/e2e-testing`. Edit the fixtures and configuration as the application evolves; they are ordinary project source.

`pnpm --filter @repo/e2e test` runs the runner's fast helper tests. It does not run browser scenarios. Component tests and visual inspection can verify presentation changes without adding a customer journey scenario.

Commercetools B2B installs company sign-in, invitations and custom checkout scenarios with either administration host. Standalone Admin contributes its registration review scenario. The Merchant Center app contributes its own approval scenario.

## Shopify B2B sandbox

Use an isolated Shopify Plus shop linked to the selected Clerk or WorkOS realm. Seed a company buyer with access to at least two locations, a company administrator for the target location, and a purchasable Trail jacket variant (size M, red). Use separate Playwright storage-state files for the two identities. Save them outside the repository after signing in to the sandbox storefront and its identity provider.

- `E2E_SHOPIFY_COMPANY_STORAGE_STATE` and `E2E_SHOPIFY_COMPANY_ADMIN_STORAGE_STATE` are the files for the buyer and administrator.
- `E2E_SHOPIFY_COMPANY_LOCATION` is the exact label in the Company switcher that both identities can access.
- `E2E_SHOPIFY_COMPANY_BUYER_EMAIL`, `E2E_SHOPIFY_COMPANY_PRODUCT_SLUG` and `E2E_SHOPIFY_CHECKOUT_ORIGIN` identify the seeded buyer, the Trail jacket product and the Shopify sandbox checkout origin.

The buyer scenario runs the Shopify OAuth exchange and ends at hosted checkout. The invitation scenario sends a real invitation through the selected identity provider, accepts it in a separate browser context and checks the buyer's membership. Configure the identity provider's browser test credentials for invitation acceptance and the Shopify Admin credentials for removing the test buyer’s membership during cleanup.

## Merchant Center sandbox

Set `E2E_MC_APPROVALS_URL` to the installed sandbox application's approvals screen on the regional Merchant Center origin. Save an authenticated reviewer with approval permissions to a Playwright storage-state file outside the repository and point `E2E_MC_STORAGE_STATE` to it. Point `E2E_API_URL` to the matching sandbox registration API. The test submits a registration, approves it through Merchant Center and checks that the workflow issued an onboarding invitation.

## Live search prerequisites

The `@search` scenarios do not intercept the Search proxy or replace Product and Resource pages. They exercise the selected Search provider through the web application's normal server and browser paths. Configure the web application with its server-side Algolia credentials and provisioned index prefix before running them.

Project the shared Product test catalog and CMS test content into Algolia using the canonical documents from `@repo/search/contract`. The scenarios declare their required records in the collocated feature files:

- `product-search.feature` defines the `en-US` Product records, facets, prices, availability, and sorting expectations.
- `search-autocomplete.feature` expects the live Product and Content indices listed in its background, plus the `excavator attachments` record in the `en-US` Query Suggestions index.
- `combined-search.feature` requires more than six Product results and more than six Resource results for `excavator` in `fr-FR` so both paginated tabs have a second page. The Content index should also contain `A practical preventive maintenance checklist` as a nonmatching record that proves the query reaches the Content child index.

Search index publication remains external to Playwright. Wait for Algolia's indexing tasks to finish before starting the suite so failed assertions reflect the application rather than an incomplete index update.

## Authoring loop

1. Add one scenario under an owning domain's scoped `e2e/@domain` directory.
2. Run `pnpm --filter @repo/e2e e2e:generate` and observe the undefined-step red.
3. Add thin bindings beside the scoped feature and browser automation under `e2e/drivers`.
4. Run the scenario against Chromium, then implement the product behavior and repeat until green.

Feature wording describes domain behavior. Steps translate that vocabulary to drivers. Drivers own routes, accessible locators, and Playwright assertions. Shared fixtures belong in `@repo/e2e-testing` only when more than one domain needs them.
