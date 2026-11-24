import type { CommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceRequestInput } from "@repo/commerce-core/runtime/commerce-request";
import type {
  CommerceBaseApplication,
  CommerceBaseRequestServices,
  CommerceBaseStableServices,
  CommerceRequestProvisionError,
} from "@repo/commerce-core/runtime/make-commerce-base-app";
import type { AddressBook } from "@repo/commerce-core/services/address-book";
import type { CommerceAccounts } from "@repo/commerce-core/services/commerce-accounts";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { DeliveryPlanning } from "@repo/commerce-core/services/delivery-planning";
import type { Orders } from "@repo/commerce-core/services/orders";
import type { CheckoutPayments } from "@repo/payments";
import { Effect, Layer } from "effect";

import type { CheckoutPolicies } from "./checkout-policy";
import { CheckoutSession } from "./checkout-session";

export type {
  CommerceContextLayer,
  CommerceRequestProvisionError,
} from "@repo/commerce-core/runtime/make-commerce-base-app";

export type CommerceRequestServices =
  | CommerceBaseRequestServices
  | CommerceAccounts
  | AddressBook
  | CheckoutSession;

export type CommerceRequestLayerServices = Exclude<
  CommerceRequestServices,
  CommerceAccounts
>;

export type AddressBookRequestServices = AddressBook | CommerceContext;

export type CommerceStableServices =
  | CommerceBaseStableServices
  | CheckoutPolicies
  | CheckoutPayments
  | DeliveryPlanning
  | Orders;

export type CommerceApplicationServices =
  | CommerceRequestServices
  | CommerceStableServices;

export interface CheckoutAppBindings<
  CommerceLayerError,
  CommerceProvisionError,
  AddressBookError,
  CheckoutPoliciesError,
  CheckoutPaymentsError,
  DeliveryPlanningError,
  OrdersError,
> {
  readonly commerce: CommerceBaseApplication<
    CommerceLayerError,
    CommerceProvisionError
  >;
  readonly addressBookLayer: Layer.Layer<
    AddressBook,
    AddressBookError,
    CommerceContext
  >;
  readonly checkoutPoliciesLayer: Layer.Layer<
    CheckoutPolicies,
    CheckoutPoliciesError
  >;
  readonly checkoutPaymentsLayer: Layer.Layer<
    CheckoutPayments,
    CheckoutPaymentsError
  >;
  readonly deliveryPlanningLayer: Layer.Layer<
    DeliveryPlanning,
    DeliveryPlanningError
  >;
  readonly ordersLayer: Layer.Layer<Orders, OrdersError>;
}

export interface CommerceApplication<
  LayerError,
  ProvisionError,
  AddressBookProvisionError = ProvisionError,
> {
  readonly layer: Layer.Layer<CommerceStableServices, LayerError>;
  readonly contextLayer: CommerceBaseApplication<
    LayerError,
    ProvisionError
  >["contextLayer"];
  readonly requestLayer: (
    request: CommerceRequestInput
  ) => Layer.Layer<
    CommerceRequestLayerServices,
    ProvisionError,
    CommerceStableServices
  >;
  readonly provide: (
    request: CommerceRequestInput
  ) => <A, E>(
    program: Effect.Effect<A, E, CommerceApplicationServices>
  ) => Effect.Effect<A, E | ProvisionError, CommerceStableServices>;
  readonly provideAddressBook: (
    request: CommerceContextRequest
  ) => <A, E>(
    program: Effect.Effect<A, E, AddressBookRequestServices>
  ) => Effect.Effect<A, E | AddressBookProvisionError, CommerceStableServices>;
}

/** The application explicitly adds custom checkout to its shared commerce runtime. */
export const makeCheckoutApp = <
  CommerceLayerError,
  CommerceProvisionError,
  AddressBookError,
  CheckoutPoliciesError,
  CheckoutPaymentsError,
  DeliveryPlanningError,
  OrdersError,
>(
  bindings: CheckoutAppBindings<
    CommerceLayerError,
    CommerceProvisionError,
    AddressBookError,
    CheckoutPoliciesError,
    CheckoutPaymentsError,
    DeliveryPlanningError,
    OrdersError
  >
): CommerceApplication<
  | CommerceLayerError
  | CheckoutPoliciesError
  | CheckoutPaymentsError
  | DeliveryPlanningError
  | OrdersError,
  CommerceProvisionError | AddressBookError,
  CommerceRequestProvisionError | AddressBookError
> => {
  const requestLayer = (request: CommerceRequestInput) => {
    const commerce = bindings.commerce.requestLayer(request);
    const addressBook = bindings.addressBookLayer.pipe(
      Layer.provideMerge(commerce)
    );
    return CheckoutSession.layer.pipe(Layer.provideMerge(addressBook));
  };

  return {
    contextLayer: bindings.commerce.contextLayer,
    layer: Layer.mergeAll(
      bindings.commerce.layer,
      bindings.checkoutPoliciesLayer,
      bindings.checkoutPaymentsLayer,
      bindings.deliveryPlanningLayer,
      bindings.ordersLayer
    ),
    provide: (request) => Effect.provide(requestLayer(request)),
    provideAddressBook: (request) =>
      Effect.provide(
        bindings.addressBookLayer.pipe(
          Layer.provideMerge(bindings.commerce.contextLayer(request))
        )
      ),
    requestLayer,
  };
};
