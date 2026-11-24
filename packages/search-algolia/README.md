# Search setup

First complete [application and source setup](docs/application-setup.md). The CLI assumes an existing Algolia application; Shopify additionally needs its Algolia AI Search & Discovery app installed and synchronized.

Set `ALGOLIA_APPLICATION_ID`, `ALGOLIA_ADMIN_API_KEY` and `ALGOLIA_REGION` in the command environment. Pass every deployment locale explicitly:

```sh
pnpm --filter cli cli search provision \
  --locale <locale> --output search.env
```

Replace the locale placeholder; repeat `--locale` for multiple locales. `--index-prefix` is optional. The selected CMS supplies its record projection and follow-up indexing tasks. Provisioning creates or updates indices, Query Suggestions and scoped keys; it does not start a CMS content sync. The result lists remaining setup and verification tasks.

## Credentials and deployment

Commands run in `apps/cli`, so relative output paths resolve there. Local publication creates a new private file; existing files are not overwritten. Load the generated runtime variables into the application's environment. CMS write keys are server-only and must never reach a browser.

`--store vercel` publishes variables to the linked web project. Repeat `--environment` to select deployment environments; use `--overwrite` explicitly to replace existing provider-owned assignments. Redeploy afterward. Vercel sensitive keys cannot be read back, so use local publication when manually copying CMS credentials.

## Commerce integration

Prepare the Commerce project before search provisioning. Search uses `CTP_*` management access to reconcile a separate connector client. A provisioning client retained with `--keep-bootstrap-client` can supply that access when its actual permissions suffice; do not reuse a revoked client.

Supply `CTP_PROJECT_KEY`, `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`, `CTP_AUTH_URL`, `CTP_API_URL` and whitespace-separated `CTP_SCOPES`. The management client needs `manage_api_clients:<project-key>` plus Store, Channel and Customer Group read access. Provisioning reconciles a separate managed connector client with the connector's required read/subscription scopes. Bootstrap and connector credentials are not exported.

`ALGOLIA_PRICE_CUSTOMER_GROUP_IDS` lists native Customer Groups to index for both consumer and company pricing. B2B Business Units use native `customerGroupAssignments`, without changing employees' groups. The transformer creates one record per group on the Store's common sales channel; the server filters by the verified buyer context's native group. Search does not depend on registration approval policies or per-company mappings. See [commercetools pricing setup](connector/commercetools/README.md), including the current single-group search constraint. Provisioning validates IDs and configures Store-bound connectors, shared currency replicas and initial reindexes. Run `pnpm --filter cli cli search types generate` after changing Product Type schemas or configured currencies/locales, then provision search.

## Contentstack app installation

Add `--install-content-search-app` to configure the selected Contentstack Algolia app directly. See `packages/cms-contentstack/README.md` for installation credentials. Otherwise use the manual setup tasks in the command result. Drupal uses its backend environment and manual Search API backfill instructions.
