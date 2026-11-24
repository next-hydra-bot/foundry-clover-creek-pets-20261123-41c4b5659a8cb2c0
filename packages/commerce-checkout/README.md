# @repo/commerce-checkout

Application-managed checkout workflows, built on `@repo/commerce-core` and `@repo/payments`.

This package owns `CheckoutSession`, checkout policies and state derivation, payment preparation/authorization, order-placement recovery, and custom order confirmation. Its runtime explicitly adds those capabilities to a shared commerce application. It also owns checkout pages, forms, server action procedures, HTTP contracts and Next.js order-access cookies. Concrete commerce/payment providers and credentials stay in the application composition.

## Application composition

Applications create shared commerce with `makeCommerceBaseApp` from `@repo/commerce-core/runtime/make-commerce-base-app`, then call `makeCheckoutApp` from this package's `runtime` entry point:

```ts
const commerce = makeCommerceBaseApp({
  commerceContextLayer,
  layer: Layer.mergeAll(cartPoliciesLayer, cartsLayer, commerceAccountsLayer),
  currentCartLayer: (request) => CurrentCart.layer(request.currentCartCookie),
  productDiscoveryLayer,
});

const checkout = makeCheckoutApp({
  commerce,
  addressBookLayer,
  checkoutPoliciesLayer,
  checkoutPaymentsLayer,
  deliveryPlanningLayer,
  ordersLayer,
});
```

Concrete client and Layer wiring stays in the applications. `checkout.layer` contains stable capabilities; `checkout.provide(request)` supplies request-scoped capabilities. `provideAddressBook` remains independently usable without a Cart cookie. A single resolved Commerce Context and Current Cart are shared across shopping and checkout within the request. `CheckoutCart` owns checkout-specific cart commands and applies them through Core's server-side `CurrentCart.modify` extension.

Package-owned Next.js views use `@repo/commerce-checkout/bindings`. The selected recipe aliases that binding to application-owned composition. There are no legacy umbrella exports.

Provider-managed checkout lives in its provider package and complete recipe. Commercetools Checkout uses `commerce-commercetools/checkout` and does not install this package or share its steps, payment preparation, or order-placement workflow.

## Recipe ownership and current scope

`commerce-checkout` installs this provider-neutral package. The internal `commerce-commercetools-custom-checkout` recipe selects the web checkout integration and the provider's Stripe integration recipe. Checkout supplies the steps, forms, policies, order placement and recovery. Application composition selects the purchasing context, delivery, payment and order implementations.

Purchasing/account routes belong to the selected B2C or B2B recipe. Company registration, approval and Admin have their own recipe. The complete storefront assembly preserves the existing blended experience and backend APIs; those are not dependencies of the checkout recipe. Web checkout runs the package procedures through server actions without requiring a separate API application. The cart/catalog HTTP add-on is independently selectable. `commerce-commercetools-checkout-api` additionally exposes custom-checkout operations inside the web app through this package’s HTTP handler; it does not install the separate API application.

The B2C recipe uses `CheckoutPayments.cardOnlyLayer` through the Stripe adapter, without initializing an account-credit store. Company checkout retains card and Net Terms support. Payment field rendering remains gateway-owned; delivery selection rendering and the workflow remain checkout-owned. Commercetools delivery integration currently quotes and persists native Shipping Methods. External shipping quotes would also need a compatible cart-persistence adapter.

Company checkout fixtures and their B2B development dependency are owned by the `commerce-checkout-company` recipe. B2B and complete assemblies select it; standalone B2C checkout keeps the generic card fixtures without pulling in the company package. The canonical source manifest retains the dependency for authoring these optional fixtures; composition removes it unless that recipe is selected.

Company self-registration adds a separate approval API. The storefront calls it through `API_INTERNAL_URL` when a Vercel service binding is present, or through `NEXT_PUBLIC_API_URL` when it is separately deployed. Standalone checkout and the optional storefront HTTP routes work on the storefront origin.

Select the `commerce-commercetools-checkout` Add-on for the alternative B2C Complete Checkout assembly. The default remains application-managed checkout. See [the provider guide](../commerce-commercetools/checkout/README.md) for configuration and limits.

## Verification

`pnpm --filter @repo/commerce-checkout test` exercises the moved workflow and explicit composition tests. `typecheck` validates its Effect environment. Application checks require composing and freshness-checking a named workspace first.
