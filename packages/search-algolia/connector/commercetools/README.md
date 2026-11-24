# Commercetools product search pricing

Product search uses the shared InstantSearch proxy and server-only Algolia adapter. The browser supplies logical queries and approved refinements; the server resolves the buyer's pricing audience, chooses physical indices and sets the mandatory `priceAudienceIds` filter. The same Product index and currency sort replicas serve all audiences. Product Detail and Cart continue using native commercetools price selection.

## Price audiences

The transformer creates one Product record for public prices and one per configured native Customer Group. B2C customer groups and B2B Business Unit groups use the same `group:NATIVE_CUSTOMER_GROUP_ID` audience and record. Each record contains only its resolved price bag in `price.CURRENCY` and `productCard.startingPrice.CURRENCY`. Native price candidates are removed from returned Variant data. Audience records add an encoded audience suffix to `objectID`; prices and configuration order do not change record identity. Companies sharing a Customer Group share the same indexed record.

Company pricing uses native Business Unit `customerGroupAssignments`, without changing employees' groups. Product Discovery reads the selected, verified Business Unit's assignments. An unset assignment inherits customer pricing; an empty assignment uses public prices. If an eligible Variant has no group-specific price, native price selection uses its public price. The transformer applies the same group and Store-channel precedence before computing the Product minimum.

## Configure and provision

Set `ALGOLIA_PRICE_CUSTOMER_GROUP_IDS` to the native Customer Group IDs this deployment should index, for both consumer and company pricing. Provisioning validates the IDs and requires one common distribution channel per Store. It does not need registration choices, company memberships or per-company pricing mappings. At runtime only the selected Business Unit's assignment is read. A group not indexed returns no matches rather than switching to a public audience with potentially wrong prices.

```dotenv
ALGOLIA_PRICE_CUSTOMER_GROUP_IDS=gold-native-id,standard-native-id
```

Only prices on the Store's configured sales channel and unqualified prices are eligible; another Store's cheaper channel cannot enter the projection. Native Customer Group specificity is applied before channel specificity.

```sh
pnpm --silent --filter cli cli \
  --env-file "$PWD/.env.bootstrap.local" \
  search provision --locale en-US \
  --store local --output "$PWD/.env.search.local"
```

Provisioning stores native group IDs and the Store channel in the per-Store transformation secret, configures shared price replicas, performs a full replacement and waits for success before publishing runtime credentials. Run `search types generate` after Product Type, currency or locale changes, then provision search. Provisioning stores the installed Product Model facet definitions and default locale in the transformation configuration and declares their localized Algolia fields in the primary and price replicas. Re-provision after changing the Product Model to refresh this configuration and the indexed values. Subscription behavior and product deletion still need live verification.

`COMMERCETOOLS_COMPANY_PURCHASING_POLICIES` is optional registration-approval configuration. It defines which Store and pricing-group choices a reviewer can assign to a newly approved company. It is independent of storefront price reads and search indexing.

Company and other private pricing-audience query batches disable analytics, including mixed Product/Content/Query Suggestions batches, so procurement terms do not feed public suggestion analytics. CMS projection and indexing remain independently composed.

## Current scope

The indexed Product Card minimum, availability, category facets, price ranges and sorting are supported. The current domain buying policy assigns one pricing group per Business Unit. Native Product Detail and Cart can use multiple Business Unit groups, but search rejects that combination until it has a projection matching native combined-group price selection; it never chooses an arbitrary group record. Business Unit Customer Group assignments are a commercetools beta feature, and the SDK GraphQL endpoint supplies the assignment action missing from the installed REST SDK types. Product Model attribute facets are installed for both B2C and B2B. The transformer combines root attributes with each Variant's overrides, validates numeric, integer, boolean, text, enum, list and Product-reference values, and indexes a union of values per Product and locale. Numeric attributes use range filters; other attributes use searchable refinement lists. Enum filters retain declared keys; translated labels come from the Product Model, without recovering keys from labels. Localized text uses the requested native value with the configured default locale as fallback. Combined refinements describe the Product family and may match different Variants; Product Detail and Cart validate the selected purchasable configuration. Embedded connector price projections are used here; standalone-price coverage, native subscription behavior and actual storefront/cart price parity require live verification.

The audience-record projection follows the pattern used by the reference storefront's pricing transformer, adapted to this repository's Company Pricing Group and Store model rather than its project-specific segmentation or unit-price rules.

## Sale prices

Native `discountedValue` takes precedence over `value` before audience-specific minimum selection. The selected price retains its own original `value` as `productCard.regularStartingPrice.CURRENCY` when higher; a tie chooses the lower original amount. Both the Product Card and numeric `price.CURRENCY` sort field therefore describe the same effective offer. Cart-only codes and automatic Cart Discounts do not change indexed catalog prices. Re-run search provisioning to deploy the transformation and rebuild reference prices.
