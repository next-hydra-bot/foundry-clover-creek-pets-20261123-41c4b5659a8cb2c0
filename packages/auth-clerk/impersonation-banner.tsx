import { getAuthRoutes, withAuth } from "./server";

export async function ImpersonationBanner() {
  const session = await withAuth();
  if (!session.actor) {
    return null;
  }
  const routes = await getAuthRoutes();
  return (
    <aside
      className="border-b bg-amber-100 p-3 text-black"
      aria-label="Customer impersonation"
    >
      Customer impersonation active. Acting as{" "}
      {session.user?.email ?? session.user?.id}; staff{" "}
      {session.actor.subject ?? session.actor.email}.{" "}
      <a className="underline" href={routes.signOutHref}>
        End impersonation
      </a>
    </aside>
  );
}
