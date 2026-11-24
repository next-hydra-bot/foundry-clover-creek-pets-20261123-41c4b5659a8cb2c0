import "server-only";
import { AuthUserId } from "@repo/auth-contract/access-token";
import { organizationPermissionsLayer } from "@repo/auth-contract/permissions";
import { authorization } from "@repo/auth-contract/permissions/admin";
import type { AdminPermission } from "@repo/auth-contract/permissions/admin";
import type { AuthSession } from "@repo/auth-contract/session";
import { getAuthRoutes, withAuth } from "@repo/auth/server";
import { Effect } from "effect";
import type { Route } from "next";
import { forbidden, redirect } from "next/navigation";

import { adminScreens } from "./admin-screens";

export const hasAdminPermission = async (
  session: AuthSession,
  permission: AdminPermission
) =>
  await Effect.runPromise(
    authorization.has(permission).pipe(
      Effect.provide(
        organizationPermissionsLayer({
          authUserId:
            session.user === null
              ? undefined
              : AuthUserId.make(session.user.id),
          organizationId: session.organizationId,
          permissions: session.permissions,
        })
      )
    )
  );

export async function requireAdminSession() {
  const session = await withAuth();
  if (!session.user) {
    const routes = await getAuthRoutes();
    // SAFETY: the selected auth recipe supplies this route; canonical route types exclude recipe-owned files.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Next's typed redirect requires Route for a provider-owned destination.
    redirect(routes.signInHref as Route);
  }
  return session;
}

export async function requireAdminPermission(permission: AdminPermission) {
  const session = await requireAdminSession();
  if (!(await hasAdminPermission(session, permission))) {
    forbidden();
  }
  return session;
}

export const visibleAdminScreens = async (session: AuthSession) => {
  const checks = await Promise.all(
    adminScreens.map(async (screen) => {
      const permissions = await Promise.all(
        screen.permissions.map(
          async (permission) => await hasAdminPermission(session, permission)
        )
      );
      return { allowed: permissions.every(Boolean), screen };
    })
  );
  return checks
    .filter(({ allowed }) => allowed)
    .map(({ screen }) => ({
      description: screen.description,
      href: screen.href,
      title: screen.title,
    }));
};
