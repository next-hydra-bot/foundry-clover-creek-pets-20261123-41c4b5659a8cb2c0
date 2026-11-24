import { getAuthRoutes } from "@repo/auth/server";

import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdminSession, visibleAdminScreens } from "@/lib/admin-auth";

export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, routes] = await Promise.all([
    requireAdminSession(),
    getAuthRoutes(),
  ]);

  const screens = await visibleAdminScreens(session);
  return (
    <AdminShell screens={screens} signOutHref={routes.signOutHref}>
      {children}
    </AdminShell>
  );
}
