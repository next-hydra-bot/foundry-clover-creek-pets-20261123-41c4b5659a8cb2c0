import type {
  CartPolicyFailure,
  CartProviderFailure,
  CartShippingOptionsRefreshRequired,
  CartShippingSelectionUnavailable,
  CartWriteConflict,
  CartWriteOutcomeUnknown,
  CurrentCartSelectionConflict,
} from "@repo/commerce-core/domain/cart-errors";
import { CurrentCartUnavailable } from "@repo/commerce-core/domain/cart-errors";
import type { CurrentCartState } from "@repo/commerce-core/domain/cart-snapshot";
import type {
  CheckoutContact,
  CheckoutDeliveryDetails,
} from "@repo/commerce-core/domain/checkout";
import type { SelectedDeliveryPlan } from "@repo/commerce-core/domain/delivery-plan";
import { checkoutDeliveryDetailsEqual } from "@repo/commerce-core/lib/checkout/delivery-details-equality";
import { selectedDeliveryPlansEqual } from "@repo/commerce-core/lib/checkout/delivery-plan-equality";
import { Carts } from "@repo/commerce-core/services/carts";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import type { PreparedPayment } from "@repo/payments";
import { Context, Effect, Layer } from "effect";

export type CheckoutCartDetailsFailure =
  | CurrentCartSelectionConflict
  | CurrentCartUnavailable
  | CartWriteConflict
  | CartWriteOutcomeUnknown
  | CartProviderFailure
  | CartPolicyFailure;

export type CheckoutCartShippingOptionsFailure =
  | CheckoutCartDetailsFailure
  | CartShippingOptionsRefreshRequired
  | CartShippingSelectionUnavailable;

const unavailable = <A, E>(
  effect: Effect.Effect<
    A,
    E | { readonly _tag: "CartNotFound" | "CartAccessDenied" }
  >
) =>
  effect.pipe(
    Effect.catchTags({
      CartAccessDenied: () =>
        new CurrentCartUnavailable({ reason: "inaccessibleCart" }),
      CartNotFound: () => new CurrentCartUnavailable({ reason: "noCart" }),
    })
  );

export class CheckoutCart extends Context.Service<
  CheckoutCart,
  {
    readonly clearPaymentOptions: () => Effect.Effect<
      CurrentCartState,
      CheckoutCartDetailsFailure
    >;
    readonly saveContact: (
      contact: CheckoutContact
    ) => Effect.Effect<CurrentCartState, CheckoutCartDetailsFailure>;
    readonly saveDeliveryDetails: (
      details: CheckoutDeliveryDetails
    ) => Effect.Effect<CurrentCartState, CheckoutCartDetailsFailure>;
    readonly savePaymentOptions: (
      payment: PreparedPayment
    ) => Effect.Effect<CurrentCartState, CheckoutCartDetailsFailure>;
    readonly saveShippingOptions: (
      plan: SelectedDeliveryPlan
    ) => Effect.Effect<CurrentCartState, CheckoutCartShippingOptionsFailure>;
  }
>()("@repo/commerce-checkout/CheckoutCart") {
  static readonly layer = Layer.effect(
    CheckoutCart,
    Effect.gen(function* () {
      const current = yield* CurrentCart;
      const carts = yield* Carts;

      return CheckoutCart.of({
        clearPaymentOptions: () =>
          current.modify((target) =>
            unavailable(carts.clearPaymentOptions({ target }))
          ),
        saveContact: (contact) =>
          current.modify((target) =>
            unavailable(carts.saveContact({ contact, target }))
          ),
        saveDeliveryDetails: (deliveryDetails) =>
          current.modify((target, cart) =>
            checkoutDeliveryDetailsEqual(
              cart.checkoutDetails.deliveryDetails,
              deliveryDetails
            )
              ? Effect.succeed(cart)
              : unavailable(
                  carts.saveDeliveryDetails({ deliveryDetails, target })
                )
          ),
        savePaymentOptions: (preparedPayment) =>
          current.modify((target) =>
            unavailable(carts.savePaymentOptions({ preparedPayment, target }))
          ),
        saveShippingOptions: (selectedDeliveryPlan) =>
          current.modify((target, cart) =>
            selectedDeliveryPlansEqual(
              cart.checkoutDetails.selectedDeliveryPlan,
              selectedDeliveryPlan
            )
              ? Effect.succeed(cart)
              : unavailable(
                  carts.saveShippingOptions({ selectedDeliveryPlan, target })
                )
          ),
      });
    })
  );
}
