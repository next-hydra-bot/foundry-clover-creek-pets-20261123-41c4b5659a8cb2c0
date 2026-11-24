import { unconfiguredNextCommerceBinding } from "@repo/commerce-core/runtime/bindings";

import type {
  CommerceRequestLayerServices,
  CommerceStableServices,
} from "./runtime";

export type {
  CommerceActionClient,
  NextCommerceRequestError,
} from "@repo/commerce-core/runtime/bindings";

/** The custom checkout recipe binds this module to the application's runtime. */
export const { CommerceActions, NextCommerce } =
  unconfiguredNextCommerceBinding<
    CommerceRequestLayerServices,
    CommerceStableServices
  >();
