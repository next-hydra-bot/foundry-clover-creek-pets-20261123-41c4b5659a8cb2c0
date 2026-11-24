import { defineAuthorization } from "@repo/auth-contract/permissions";

export const FULFILLMENT_READ_PERMISSION = "fulfillment.read";
export const FULFILLMENT_MANAGE_PERMISSION = "fulfillment.manage";
export const fulfillmentPermissions = [
  FULFILLMENT_READ_PERMISSION,
  FULFILLMENT_MANAGE_PERMISSION,
] as const;
export const fulfillmentAuthorization = defineAuthorization(
  fulfillmentPermissions
);
