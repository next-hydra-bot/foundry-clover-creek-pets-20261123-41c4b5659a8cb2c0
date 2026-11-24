import type { AuthSessionAdapter } from "@repo/auth-contract/session";

import { unconfiguredNextCommerceBinding } from "../../runtime/bindings";
import type { CommerceBaseStableServices } from "../../runtime/make-commerce-base-app";
import type { CommerceContext } from "../../services/commerce-context";
import type { ShoppingLists } from "../../services/shopping-lists";

/** The optional web recipe binds this module to the application's authorized runtime. */
export const { Actions, NextCommerce } = unconfiguredNextCommerceBinding<
  CommerceContext,
  CommerceBaseStableServices | ShoppingLists | AuthSessionAdapter
>();
