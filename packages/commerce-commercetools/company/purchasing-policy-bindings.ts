import { CompanyPurchasingPolicy } from "@repo/commerce-core/domain/company-purchasing-policy";
import { Schema } from "effect";

export const CommercetoolsPurchasingPolicyBindings = Schema.Array(
  Schema.Struct({
    ...CompanyPurchasingPolicy.fields,
    customerGroupId: Schema.NonEmptyString,
  })
);
export type CommercetoolsPurchasingPolicyBindings =
  typeof CommercetoolsPurchasingPolicyBindings.Type;
