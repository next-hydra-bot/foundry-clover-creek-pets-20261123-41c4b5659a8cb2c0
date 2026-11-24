import { submitFulfillment } from "@repo/commerce-core/fulfillment/admin/actions";
import { FulfillmentAdminPage } from "@repo/commerce-core/fulfillment/admin/page";
import type { FulfillmentSearchParams } from "@repo/commerce-core/fulfillment/admin/page";
import {
  FULFILLMENT_MANAGE_PERMISSION,
  FULFILLMENT_READ_PERMISSION,
} from "@repo/commerce-core/fulfillment/permissions";
import { revalidatePath } from "next/cache";

import { hasAdminPermission, requireAdminPermission } from "@/lib/admin-auth";

async function pack(form: FormData) {
  "use server";
  const session = await requireAdminPermission(FULFILLMENT_MANAGE_PERMISSION);
  const result = await submitFulfillment("pack", form, session.accessToken);
  if (result.ok) {
    revalidatePath("/fulfillment");
  }
  return result;
}
async function ship(form: FormData) {
  "use server";
  const session = await requireAdminPermission(FULFILLMENT_MANAGE_PERMISSION);
  const result = await submitFulfillment("ship", form, session.accessToken);
  if (result.ok) {
    revalidatePath("/fulfillment");
  }
  return result;
}
export default async function Page({
  searchParams,
}: {
  searchParams: FulfillmentSearchParams;
}) {
  const session = await requireAdminPermission(FULFILLMENT_READ_PERMISSION);
  return (
    <FulfillmentAdminPage
      accessToken={session.accessToken}
      canManage={await hasAdminPermission(
        session,
        FULFILLMENT_MANAGE_PERMISSION
      )}
      pack={pack}
      searchParams={searchParams}
      ship={ship}
    />
  );
}
