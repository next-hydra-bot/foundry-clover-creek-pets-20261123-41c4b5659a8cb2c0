import { impersonationAdminScreens } from "@repo/auth-contract/impersonation-screens";
import type { AdminPermission } from "@repo/auth-contract/permissions/admin";
import { fulfillmentAdminScreens } from "@repo/commerce-core/fulfillment/admin/screens";

export interface AdminScreen {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly permissions: readonly AdminPermission[];
}

export const adminScreens: readonly AdminScreen[] = [
  ...[impersonationAdminScreens, fulfillmentAdminScreens].flat(),
];
