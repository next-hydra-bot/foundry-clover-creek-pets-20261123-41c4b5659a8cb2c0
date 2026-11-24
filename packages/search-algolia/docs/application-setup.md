# Algolia application and source setup

`search provision` configures search resources inside an existing Algolia application. It does not create that application or establish an account login. Complete application access and the selected commerce/CMS source before declaring search ready.

## Application and credentials

Create or reconcile the intended application in the existing Algolia account. Use Algolia's official CLI application commands when account access is already configured, or its dashboard. Discover the installed CLI's current flags; an application-scoped Admin key is not an account-level login. Reconcile actual Application IDs before retrying a timed-out create. Keep account ownership, terms and billing decisions with the operator rather than creating another account or silently switching plans.

For CLI/API output that includes credentials, save it privately and report only IDs/status. Keep the actual Application ID and analytics/Ingestion region in the project receipt, together with the index prefix and connector identities. Configure `ALGOLIA_APPLICATION_ID`, `ALGOLIA_ADMIN_API_KEY` and `ALGOLIA_REGION` (`us` or `eu`) in a private bootstrap ENV. CLI hosting-region labels are not the same contract as the Ingestion region; use the application's actual metadata. A configured existing application can be reused with a stable site-specific `--index-prefix`. The Admin key is not a web runtime credential.

References: [official CLI guidance](https://github.com/algolia/skills/blob/main/skills/algolia-cli/SKILL.md), [Algolia account/application automation](https://www.algolia.com/blog/engineering/agents-can-now-sign-up-for-algolia).

## Shopify source installation

Read [Shopify product search](../connector/shopify/README.md). In the recorded shop, install **Algolia AI Search & Discovery** and connect it to the same Algolia application. The Shopify app installation and Algolia cloud application are separate resources. Existing Admin API credentials alone do not install the Shopify app or authenticate its managed source.

After the catalog, selling contexts and company pricing are imported:

1. Publish the intended products to Online Store **and** Headless. The managed source indexes Online Store products even when the frontend is headless.
2. Configure Product indexing mode and Markets indexing for the intended countries/currencies/languages. For category relationships enable **Algolia on Collection pages**; the separate collection-indexing checkbox is insufficient for native `collection_ids` on product records.
3. For B2B enable **Include B2B company location data** and complete its B2B re-sync/reindex. Use the actual imported group/Market policy bindings.
4. Complete the managed app's initial sync and inspect its real task results. This integration does not need Algolia theme embeds or blocks. The redirect theme can continue sending Online Store traffic to the headless frontend.

Then run the workspace's `search provision`. It consumes the installed managed source and configures owned projections/tasks. A standalone unauthenticated source does not substitute for app installation. Follow native feature/plan errors and the documented update cadence; B2B indexing is not assumed real time.

## commercetools source

Complete the recorded Project's catalog/model and selling configuration, then follow [commercetools pricing setup](../connector/commercetools/README.md). Search uses `CTP_*` management access to reconcile its separate connector client. A retained provisioning client can supply that access when its real permissions suffice; a revoked client cannot. Keep connector/runtime keys separate and let the CLI/API report required permission changes.

## Provision and verify populated search

Use private input/output paths from the workspace root, every requested locale and the same site-specific prefix on retries:

```sh
pnpm --filter cli cli --env-file /private/search-bootstrap.env search provision \
  --index-prefix site-key --locale en-US --dry-run
pnpm --filter cli cli --env-file /private/search-bootstrap.env search provision \
  --index-prefix site-key --locale en-US --output /private/search-runtime.env
```

The CLI owns index settings, transformations, replicas, Query Suggestions, connector/reindex operations and scoped runtime keys. Complete its remaining CMS tasks: index creation does not sync content. Contentstack can use `--install-content-search-app` with its documented installation access.

Verify expected products through the real storefront with the scoped search key, requested locales, facets and price sorting. For B2B verify each buyer group's prices/visibility and public results after sign-out. Confirm source edits/deletions propagate according to the connector's update cadence. Product records may fan out by market/audience; do not compare raw counts to SKU count. Report native sync/reindex completion and any pending CMS backfill separately. Successful ENV publication or empty index creation is not search completion.
