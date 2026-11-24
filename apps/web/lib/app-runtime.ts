import { authSessionAdapterLayer } from "@repo/auth/server";
import { b2cPurchasingContextLayer } from "@repo/commerce-b2c/commerce-context";
import {
  findOrderDetail as personalOrderDetail,
  listOrders as personalOrders,
} from "@repo/commerce-b2c/orders/programs";
import { withShoppingListAuthorization } from "@repo/commerce-b2c/shopping-lists/layer";
import "server-only";
import { CheckoutPolicies } from "@repo/commerce-checkout/checkout-policy";
import { makeCheckoutApp } from "@repo/commerce-checkout/runtime";
import { makeCommerceBaseApp } from "@repo/commerce-core/runtime/make-commerce-base-app";
import type { CommerceBaseStableServices } from "@repo/commerce-core/runtime/make-commerce-base-app";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import { additionalCommerceServicesLayer } from "@repo/commerce-provider/additional-services";
import { orderQueriesLayer } from "@repo/commerce-provider/orders/queries";
import {
  addressBookLayer,
  cartsLayer,
  cartPoliciesLayer,
  commercetoolsClientsLayer,
  commerceAccountsLayer,
  customerProfilesLayer,
  deliveryPlanningLayer,
  ordersLayer,
  productDiscoveryLayer,
} from "@repo/commerce-provider/provider";
import { sentryEffectTelemetryLayer } from "@repo/observability/effect";
import { commercetoolsStripeCardCheckoutPaymentsLayer } from "@repo/payments-stripe/server/commercetools";
import { Layer, ManagedRuntime } from "effect";

import { currentAuthLayer } from "./current-auth";
import { nextRequestApiLayer } from "./next-request";
import { nextServerLayer } from "./next-server";

const commerceLayer: Layer.Layer<CommerceBaseStableServices> = Layer.mergeAll(
  Layer.orDie(cartPoliciesLayer),
  Layer.orDie(cartsLayer),
  Layer.orDie(commerceAccountsLayer)
);

export const CommerceBaseApp = makeCommerceBaseApp({
  layer: commerceLayer,
  commerceContextLayer: b2cPurchasingContextLayer,
  currentCartLayer: (request) => CurrentCart.layer(request.currentCartCookie),
  productDiscoveryLayer: Layer.orDie(productDiscoveryLayer),
});

export const CommerceApp = makeCheckoutApp({
  commerce: CommerceBaseApp,
  addressBookLayer: Layer.orDie(addressBookLayer),
  checkoutPaymentsLayer: Layer.orDie(
    commercetoolsStripeCardCheckoutPaymentsLayer
  ),
  checkoutPoliciesLayer: CheckoutPolicies.layer,
  deliveryPlanningLayer: Layer.orDie(
    deliveryPlanningLayer.pipe(Layer.provide(commercetoolsClientsLayer))
  ),
  ordersLayer: Layer.orDie(
    ordersLayer.pipe(Layer.provide(commercetoolsClientsLayer))
  ),
});

export const appLayer = Layer.mergeAll(
  Layer.orDie(additionalCommerceServicesLayer),
  orderQueriesLayer.pipe(Layer.provide(commercetoolsClientsLayer), Layer.orDie),
  CommerceApp.layer,
  Layer.orDie(customerProfilesLayer),

  authSessionAdapterLayer,
  currentAuthLayer,
  nextRequestApiLayer,
  nextServerLayer,
  sentryEffectTelemetryLayer
).pipe(withShoppingListAuthorization);
export const AppRuntime = ManagedRuntime.make(appLayer);

export const orderPrograms = {
  personal: {
    findOrderDetail: personalOrderDetail,
    listOrders: personalOrders,
  },
};

export const purchasingMode = "b2c" as const;
