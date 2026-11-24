import "server-only";
import { impersonationAdminClient } from "@repo/auth-contract/impersonation-client";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import Link from "next/link";

import { ImpersonationLaunchForm } from "./launch-form";
import type { ImpersonationAction } from "./launch-form";

export async function ImpersonationAdminPage({
  accessToken,
  action,
  canStart,
  searchParams,
}: {
  readonly accessToken?: string;
  readonly action: ImpersonationAction;
  readonly canStart: boolean;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = Option.getOrElse(
    Schema.decodeUnknownOption(Schema.String)(params.query),
    () => ""
  );
  const userId = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.NonEmptyString)(params.userId)
  );
  const cursor = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.NonEmptyString)(params.cursor)
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      if (!accessToken) {
        return { error: "Sign in again to use customer impersonation." };
      }
      const client = yield* impersonationAdminClient(accessToken);
      const users = query ? (yield* client.find(query)).users : [];
      const history = userId
        ? yield* client.history(userId, cursor)
        : undefined;
      return { error: undefined, history, users };
    }).pipe(
      Effect.catch(() =>
        Effect.succeed({
          error:
            "Customer impersonation could not be loaded. Check access and API configuration.",
        })
      ),
      Effect.provide(FetchHttpClient.layer)
    )
  );
  return (
    <div className="grid gap-6">
      <h1 className="font-semibold text-3xl">Customer impersonation</h1>
      <p>
        Find a customer identity by exact email or authentication user ID.
        Customer permissions remain in effect during impersonation; staff
        identity is retained separately.
      </p>
      <form className="flex gap-3">
        <label>
          Customer identity
          <input
            className="ml-2 rounded border p-2"
            defaultValue={query}
            name="query"
            maxLength={320}
            required
          />
        </label>
        <button className="rounded border px-4" type="submit">
          Find customer
        </button>
      </form>
      {result.error ? (
        <p role="alert">{result.error}</p>
      ) : (
        "users" in result && (
          <>
            <ul>
              {result.users?.map((user) => (
                <li key={user.id}>
                  <Link
                    href={{
                      pathname: "/impersonation",
                      query: { query, userId: user.id },
                    }}
                  >
                    {[user.firstName, user.lastName]
                      .filter(Boolean)
                      .join(" ")
                      .trim() ||
                      (user.email ?? user.id)}{" "}
                    · {user.id}
                  </Link>
                </li>
              ))}
            </ul>
            {query && result.users?.length === 0 && (
              <p>No matching customer identity found.</p>
            )}
            {userId && (
              <section className="grid gap-4">
                <h2 className="font-semibold text-xl">Customer {userId}</h2>
                {canStart && (
                  <ImpersonationLaunchForm action={action} userId={userId} />
                )}
                <h2 className="font-semibold text-xl">
                  {result.history?.coverage === "active"
                    ? "Active impersonation sessions"
                    : "Impersonation session history"}
                </h2>
                <p>
                  These records come from the configured audit adapter, using
                  native identity-provider sessions by default. A dashboard
                  handoff is not a completed session. Retention follows the
                  configured source.
                </p>
                {result.history?.coverage === "active" && (
                  <p>
                    This API lists active sessions only. Ended sessions are not
                    included; use the provider audit view or a configured
                    archive for historical review.
                  </p>
                )}
                {result.history?.auditUrl && (
                  <a
                    className="underline"
                    href={result.history.auditUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Open provider audit view
                  </a>
                )}
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Staff actor</th>
                      <th>Reason</th>
                      <th>Started</th>
                      <th>Ends / ended</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.history?.items.map((session) => (
                      <tr key={session.id}>
                        <td>{session.id}</td>
                        <td>
                          {session.actor.subject ?? session.actor.email} (
                          {session.actor.provider})
                        </td>
                        <td>
                          {session.actor.reason ?? "Not supplied by provider"}
                        </td>
                        <td>
                          <time dateTime={session.createdAt}>
                            {session.createdAt}
                          </time>
                        </td>
                        <td>{session.endedAt ?? session.expiresAt}</td>
                        <td>{session.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.history?.items.length === 0 && (
                  <p>
                    No impersonation sessions in this page. Other customer
                    sessions are excluded.
                  </p>
                )}
                {result.history?.nextCursor && (
                  <Link
                    href={{
                      pathname: "/impersonation",
                      query: {
                        cursor: result.history.nextCursor,
                        query,
                        userId,
                      },
                    }}
                  >
                    Next sessions
                  </Link>
                )}
              </section>
            )}
          </>
        )
      )}
    </div>
  );
}
