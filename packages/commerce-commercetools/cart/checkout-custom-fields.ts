import {
  CheckoutContact,
  CheckoutDeliveryDetails,
} from "@repo/commerce-core/domain/checkout";
import { Schema } from "effect";

import { define, OrderCustomFields } from "../custom-fields";

export const CheckoutOrderCustomFields = define({
  fields: {
    ...OrderCustomFields.fields,
    checkoutContact: Schema.optionalKey(Schema.fromJsonString(CheckoutContact)),
    checkoutDeliveryDetails: Schema.optionalKey(
      Schema.fromJsonString(CheckoutDeliveryDetails)
    ),
  },
  typeKey: OrderCustomFields.typeKey,
});
