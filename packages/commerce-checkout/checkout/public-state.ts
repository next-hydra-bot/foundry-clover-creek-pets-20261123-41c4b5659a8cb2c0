import {
  CartPublicCheckoutDetails,
  CartPublicSnapshot,
  toCartPublicCheckoutDetails,
  toCartPublicSnapshot,
} from "@repo/commerce-core/cart/public-state";
import { CheckoutViolation } from "@repo/commerce-core/domain/checkout";
import { CheckoutState } from "@repo/commerce-core/domain/checkout-state";
import { CommerceLocale } from "@repo/commerce-core/store";
import { Schema } from "effect";

import { checkoutViolationMessage } from "../lib/checkout/violation-message";

export {
  CartPublicCheckoutDetails as CheckoutPublicDetails,
  CartPublicPreparedPayment as CheckoutPublicPreparedPayment,
  CartPublicSnapshot as CheckoutPublicCart,
} from "@repo/commerce-core/cart/public-state";

export const CheckoutPublicViolation = Schema.Struct({
  ...CheckoutViolation.fields,
  message: Schema.String,
});
export type CheckoutPublicViolation = typeof CheckoutPublicViolation.Type;

export const CheckoutPublicScope = Schema.Union([
  Schema.Struct({
    channel: Schema.Literal("storefrontPersonal"),
    locale: CommerceLocale,
  }),
  Schema.Struct({
    channel: Schema.Literal("storefrontAnonymous"),
    locale: CommerceLocale,
  }),
  Schema.Struct({
    channel: Schema.Literal("storefrontCustomer"),
    locale: CommerceLocale,
  }),
]);
export type CheckoutPublicScope = typeof CheckoutPublicScope.Type;

export const CheckoutPublicState = Schema.Struct({
  cart: CartPublicSnapshot,
  details: CartPublicCheckoutDetails,
  nextStep: CheckoutState.fields.nextStep,
  scope: CheckoutPublicScope,
  steps: CheckoutState.fields.steps,
  violations: Schema.Array(CheckoutPublicViolation),
});
export type CheckoutPublicState = typeof CheckoutPublicState.Type;

export const toCheckoutPublicState = (
  state: CheckoutState
): CheckoutPublicState => ({
  cart: toCartPublicSnapshot(state.cart),
  details: toCartPublicCheckoutDetails(state.details),
  nextStep: state.nextStep,
  scope: {
    channel: state.scope.channel,
    locale: state.scope.locale,
  },
  steps: state.steps,
  violations: state.violations.map((violation) => ({
    ...violation,
    message: checkoutViolationMessage(state.scope.locale, violation),
  })),
});
