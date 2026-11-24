# Import the shared domain catalogs into Commercetools

Migrate SDK reads `commerce-core/catalog/b2b.json` or `b2c.json`, validates the domain catalog, and maps it to native Commercetools resources. The same files feed the Shopify importer. Provider IDs and native schema definitions stay in this package.

`@migrate-sdk/commercetools` applies and journals product, inventory, Product Selection, Store and Business Unit changes. Where the destination has no capability, the importer uses the platform SDK and records acknowledged writes in the same migration journal.

## Target setup

Copy `.env.example` to `.env` in this directory. Existing shell environment values take precedence. Use a development project and a provisioning API client; the example uses `manage_project:PROJECT_KEY`. Keep these credentials separate from the storefront runtime client.

The selected Store must already exist and have at least one inventory supply channel and one price distribution channel. Set `COMMERCETOOLS_CATALOG_DISTRIBUTION_CHANNEL_ID` and `COMMERCETOOLS_CATALOG_SUPPLY_CHANNEL_ID` to the explicit native IDs attached to that Store. Importing rejects missing or mismatched channels. Runtime discovery and cart writes require exactly one distribution channel on a Store, so an ambiguous native ordering never chooses pricing. It adds an active `catalog-seed-b2b` or `catalog-seed-b2c` Product Selection to that Store. Existing selections remain attached. Select the Store that the composed application's Store configuration resolves for `en-US` (currently `default-store` by default). Use separate projects/Stores for independent B2B and B2C testing; this tooling does not configure the application's buying context.

Missing Product Types used by the selected catalog are created from Core's installed `catalog/product-model.json` through this provider's native mapping. Existing incompatible attribute types/constraints stop the import with a reconciliation error. Run the existing commerce schema migration after reviewing the target schema; this importer does not silently change existing Product Types. In particular, construction equipment capacity now allows per-variant values, and outdoor products require the size/color attributes in the checked-in schema.

The definitions can be listed or planned without credentials:

```sh
pnpm --filter @repo/commerce-commercetools catalog run --group b2c --plan
pnpm --filter @repo/commerce-commercetools catalog run --group b2c
pnpm --filter @repo/commerce-commercetools catalog status --group b2c
pnpm --filter @repo/commerce-commercetools catalog messages --group b2c
```

Use `--group b2b` for equipment. These commands also work in a composed customer workspace. The Product migration publishes each Product. Category membership, Product references, Inventory Entries and Product Selection membership have separate migration definitions and item state. Inspect item failures after execution. A dependency plan checks the graph. The document source validates the catalog when discovery or retry reads it.

## Mapping and recovery

Product keys and SKUs stay stable. Typed enums become native attribute keys, with labels owned by native Product Types. Size and color map back into Core's Product Options through the existing storefront reader. Related source keys become native product references after the product stage.

Core regular prices become embedded prices scoped to the Store's distribution channel. Optional discounted prices use a catalog-owned external Product Discount restricted to the source SKUs; they preserve the source's exact regular and sale amounts. This is fixture pricing, not a new contract or promotion engine. [Commercetools external discounts](https://docs.commercetools.com/api/projects/productDiscounts) support setting a discounted value on individual prices.

Each native Product Type has a tracked item in `<catalog>-product-type-definitions`. The Product migration requires its own Type record, creates a staged Product, and publishes it in the same item. Updates to an already-published Product write its catalog content to both projections without promoting other staged edits. Category-only source changes run through `category-products`, which adds missing category links to current and staged Product data and preserves existing memberships and order hints. The `product-references` migration resolves tracked IDs. The `selection-products` migration attaches a Product to the source Store's selection after its category and reference records succeed. The `inventory` migration tracks each SKU in the selected supply channel and runs independently of selection membership.

Tracking state lives in `catalog/.migrate/`, separated by project, region and Store. Keep it persistent for the same target. Unchanged successful items are skipped; rerun after transient failures or select `--failed`. Reads by stable key recover uncertain creates without creating duplicates. Versioned updates fail on concurrent modifications and reconcile on a subsequent run. The standalone import disables native HTTP mutation retries. On the first run after splitting the publication migration, the new inventory items may reapply source quantities to the source Store's supply channel.

Start with fresh local tracking state when repopulating a wiped project.

Existing products must carry the matching `catalog-seed-GROUP-SKU` variant keys before this importer will update them. Foreign products, a changed Product Type, or unexpected variants fail for review. Updating an owned product replaces seeded attributes and its unqualified base price for the configured channel/currency. Prices for other channels/currencies, Customer Groups, countries and validity periods are preserved. Removing a source item does not delete remote resources. The importer does not roll back partial imports or delete orphaned resources.

An Inventory item reconciles its initial `quantityOnStock` whenever it runs. Changes limited to a Product's title, price or images leave its Inventory item unchanged. An explicit `--update` or a retry of a failed Inventory item reapplies the seed quantity. The new relationship definitions have their own state and run on the first import after this split. Run complete prerequisites before using Migrate SDK's per-definition `--limit` with related products.

Tests exercise both sources through real Migrate SDK execution and the storefront reader, plus native SDK HTTP fixtures for provisioning, publication order, retry recovery and ownership checks. Live permissions, indexing/visibility and purchases still require a configured development project.

## Images, categories and translations

Source categories become native Categories with stable keys and an ownership marker in `externalId`. Missing categories are created before products; existing foreign categories are rejected. Category names/descriptions and product names/descriptions map to native LocalizedStrings using the catalog default locale and every supplied translation. Configured application locales without a supplied translation receive the base content as a fallback. Slugs stay equal to stable source keys in every configured locale. The existing GraphQL reader selects the requested locale and projects category names into Core.

Product category keys become native references. Variant galleries become native external images with URL, dimensions and optional label. Updates rebuild that variant's gallery in source order. Commercetools keeps these external URLs; the provider's Next configuration permits the starter catalog photos hosted under `cdn.shopify.com/s/files/` and the earlier `placehold.co` placeholders. The image source does not change the commerce provider. Add your own image host through the existing Next configuration when replacing demo imagery.

Both fixtures include French content. Their base prices remain USD; translations do not configure another currency or attach the catalog to another Store. Configure locale eligibility, Store selection, channels and pricing for the storefront being tested. Product Type attribute labels and enum labels come from the shared Product Model, including French outdoor Size/Color labels and color choices. Enum values with translated labels use native localized enums (`lenum`). An existing plain enum needs an explicit native schema migration before reimporting that changed type; the importer rejects incompatible existing definitions. Attribute text and image labels are not translated by this mapping.

## Custom models and sources

See the [agent authoring workflow](../../commerce-core/catalog/README.md#agent-authored-product-models-and-catalogs) for declaring project-owned data in `migrate.config.ts`. The native Product Type mapper consumes the same neutral model as the Shopify provider. `commerce types generate` now generates Core Product Attributes from that model while keeping provider Custom Field generation separate. Native schema export remains available for inspection and migration work; it is not the model authority for catalog imports. Custom reference fields are resolved by source product key after all products exist. Required reference constraints and numeric/text bounds are enforced in Core; native reference fields remain optional during staged creation.

## Company assortments and fixed prices

The [B2B setup guide](../../commerce-b2b/catalog/README.md) describes the shared machinery source, selling profile, company assignments and commands. The starter `b2b.migrate.config.ts` declares those files and expects `b2b-bindings.json` beside it. Copy `b2b-bindings.example.json` there. Catalog credentials need `manage_customer_groups` alongside the existing product, Business Unit, Store and channel management scopes (or `manage_project`). Runtime only needs Customer Group reads and its existing Business Unit operations. Each binding explicitly names the pricing group's native `customerGroupKey`, the Store's `distributionChannelKey` and its inventory `supplyChannelKey`. Companies in one Store share its sales and supply channels; separate Customer Groups select their prices. One Business Unit uses the same Customer Group across Stores, with a price list per currency.

```sh
pnpm --filter @repo/commerce-commercetools catalog:b2b run --all --plan
pnpm --filter @repo/commerce-commercetools catalog:b2b run --all
```

The `project-setup` group provisions bound Channels, then Stores. Run it by itself with `catalog:b2b run --group project-setup` or include it through the full command above. `commerce data setup` uses the same migrations before writing Business Units. The Store migration creates missing Stores with their declared channels, languages, and localized names. It updates the declared languages and names of matching Stores by key while preserving extra locales. An existing Store with different or empty channel lists fails validation. Define each market's Store language in the commercetools Project before creating the Store. The source import still uses the preconfigured Store and channel IDs described above. The standalone company and base catalog definitions share one tracking directory so they can run as one graph.

Separate migrations own Customer Groups, Product Selections, selection membership, Store assignments, fixed prices and Business Unit pricing assignments. Standalone setup also provisions Business Units by key. Full setup consumes the Business Unit records from its existing provisioning graph. The separate `commercetools-market-inventory` migration creates missing Inventory Entries by supply Channel and SKU and preserves existing quantities. The source inventory migration owns entries in its configured Channel. Full company imports select both inventory migrations alongside the assortment and pricing work. The Store must use its declared single distribution channel and supply channel. Existing Business Units must use explicit Stores; missing associations are added without removing other Stores. Prices carry the native Customer Group and common Store channel; Business Units receive native `customerGroupAssignments` through the SDK GraphQL endpoint. Employee groups remain unchanged. Conflicting existing Business Unit assignments fail instead of being overwritten. Associate memberships remain owned by the company registration/member workflows. The public assortment is selected by `stores[].assortmentKey` in the selling profile, independently of company assignments. The company price list covers the market variants. Source variant keys/SKUs are verified, company prices carry stable ownership keys, and separately managed price collisions fail. Selection membership is reconciled exactly, including removals, with a complete read bounded to 500 products. Mutations use native versions and do not retry HTTP writes automatically. Retry the Migrate group after inspecting partial failures; native unique keys recover uncertain creates without guessing from labels.

A fresh source-product import preserves company prices. Source products are published before their company catalogs are assigned. The selling profile's Store keys/locale/currency combinations must also be selected by the application's Core Store configuration to shop those contexts; importing never changes application routes, authentication or deployment configuration.

Provision into a fresh project using these bindings. The importer writes native Customer Group-scoped prices and Business Unit assignments directly. Stable ownership keys include the sales channel, pricing group, currency and SKU, so one group can serve multiple Stores without overwriting another channel’s prices. Reruns remain idempotent and preserve separately managed prices. There is no compatibility path for the previous channel-based company-pricing model. Provision Algolia after the catalog is ready.
