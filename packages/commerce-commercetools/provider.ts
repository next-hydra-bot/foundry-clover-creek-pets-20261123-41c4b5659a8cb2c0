import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { Layer } from "effect";

import { cartsLayer as carts } from "./cart";
import { commercetoolsClientsLayer } from "./client/layers";

/** The provider owns its transport; applications consume a ready-to-use cart layer. */
export const cartsLayer = carts.pipe(Layer.provide(commercetoolsClientsLayer));
export const cartPoliciesLayer = CartPolicies.layer;

export { addressBookLayer } from "./address-book";
export { paymentRepositoryLayer } from "./payment-repository";
export { ordersLayer } from "./orders";
export { deliveryPlanningLayer } from "./delivery-planning";
export { commercetoolsClientsLayer } from "./client/layers";
export {
  customerProfilesLayer,
  commerceAccountsLayer,
  commerceCompanyMembershipsLayer,
} from "./commerce-accounts";
export { productDiscoveryLayer } from "./product";
export { companyProfilesLayer } from "./company/profiles";

export { orderQueriesLayer } from "./orders/queries";
