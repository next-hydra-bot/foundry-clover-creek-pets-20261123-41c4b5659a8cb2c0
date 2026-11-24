import { submitImpersonation } from "@repo/auth/impersonation/admin-actions";
import { ImpersonationAdminPage } from "@repo/auth/impersonation/admin-page";
import type { ImpersonationActionResult } from "@repo/auth/impersonation/launch-form";

import { hasAdminPermission, requireAdminPermission } from "@/lib/admin-auth";

async function launch(
  _previous: ImpersonationActionResult,
  form: FormData
): Promise<ImpersonationActionResult> {
  "use server";
  const session = await requireAdminPermission("impersonation.start");
  return await submitImpersonation(form, session.accessToken);
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminPermission("impersonation.read");
  return (
    <ImpersonationAdminPage
      accessToken={session.accessToken}
      action={launch}
      canStart={await hasAdminPermission(session, "impersonation.start")}
      searchParams={searchParams}
    />
  );
}
