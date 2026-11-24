import { defineAuthorization } from "../permissions";

export const authorization = defineAuthorization([
  "impersonation.read",
  "impersonation.start",
  "fulfillment.read",
  "fulfillment.manage",
] as const);
export const adminPermissions = authorization.permissions;
export type AdminPermission = (typeof adminPermissions)[number];
