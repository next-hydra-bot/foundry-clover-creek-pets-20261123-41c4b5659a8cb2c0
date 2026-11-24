import { Context, Effect, Schema } from "effect";

import { AuthUserId } from "./access-token";
import { SessionActor } from "./actor";
import { defineAuthorization } from "./permissions";
import type { AuthUser } from "./session";
import { AuthUsers } from "./users";

export const IMPERSONATION_REASON_LIMIT = 1000;

export const impersonationPermissions = [
  "impersonation.read",
  "impersonation.start",
] as const;
export const impersonationAuthorization = defineAuthorization(
  impersonationPermissions
);
export const StaffActor = Schema.Struct({
  issuer: Schema.NonEmptyString,
  sessionId: Schema.optional(Schema.NonEmptyString),
  subject: Schema.NonEmptyString,
});
export type StaffActor = typeof StaffActor.Type;
/** Supplied by staff authentication, never constructed from submitted actor fields. */
export class ImpersonationStaff extends Context.Service<
  ImpersonationStaff,
  StaffActor
>()("@repo/auth/ImpersonationStaff") {}

export class ImpersonationFailure extends Schema.TaggedError<ImpersonationFailure>()(
  "ImpersonationFailure",
  {
    reason: Schema.Literals([
      "unauthorized",
      "forbidden",
      "notFound",
      "invalidInput",
      "unavailable",
      "invalidData",
      "outcomeUnknown",
    ]),
  }
) {}
export const ImpersonationLaunchInput = Schema.Struct({
  reason: Schema.NonEmptyString.check(
    Schema.isMaxLength(IMPERSONATION_REASON_LIMIT)
  ),
  userId: AuthUserId,
});
export type ImpersonationLaunchInput = typeof ImpersonationLaunchInput.Type;
export const ImpersonationLaunch = Schema.Struct({
  mode: Schema.Literals(["direct", "providerDashboard"]),
  /** A short-lived bearer destination for direct launches; never persist or log it. */
  url: Schema.NonEmptyString,
});
export type ImpersonationLaunch = typeof ImpersonationLaunch.Type;
export class AuthImpersonation extends Context.Service<
  AuthImpersonation,
  {
    readonly launch: (
      input: ImpersonationLaunchInput & { readonly actor: StaffActor }
    ) => Effect.Effect<ImpersonationLaunch, ImpersonationFailure>;
  }
>()("@repo/auth/AuthImpersonation") {}

export class ImpersonationDirectory extends Context.Service<
  ImpersonationDirectory,
  {
    /** Exact user ID or email lookup within the customer identity application. */
    readonly find: (
      query: string
    ) => Effect.Effect<readonly AuthUser[], ImpersonationFailure>;
  }
>()("@repo/auth/ImpersonationDirectory") {}
export const ImpersonationSession = Schema.Struct({
  actor: SessionActor,
  createdAt: Schema.NonEmptyString,
  endedAt: Schema.optional(Schema.NonEmptyString),
  expiresAt: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
  userId: AuthUserId,
});
export type ImpersonationSession = typeof ImpersonationSession.Type;
export const ImpersonationHistory = Schema.Struct({
  auditUrl: Schema.optional(Schema.NonEmptyString),
  coverage: Schema.Literals(["history", "active"]),
  items: Schema.Array(ImpersonationSession),
  nextCursor: Schema.optional(Schema.NonEmptyString),
});
export type ImpersonationHistory = typeof ImpersonationHistory.Type;
/** Pluggable audit source. Active-session APIs explicitly declare their limited coverage. */
export class ImpersonationAudit extends Context.Service<
  ImpersonationAudit,
  {
    readonly list: (input: {
      readonly userId: AuthUserId;
      readonly cursor?: string;
    }) => Effect.Effect<ImpersonationHistory, ImpersonationFailure>;
  }
>()("@repo/auth/ImpersonationAudit") {}

const requirePermission = (
  permission: (typeof impersonationPermissions)[number]
) =>
  impersonationAuthorization.has(permission).pipe(
    Effect.mapError(() => new ImpersonationFailure({ reason: "unavailable" })),
    Effect.flatMap((allowed) =>
      allowed
        ? Effect.void
        : Effect.fail(new ImpersonationFailure({ reason: "forbidden" }))
    )
  );

export const launchImpersonation = Effect.fn("Impersonation.launch")(function* (
  input: ImpersonationLaunchInput
) {
  yield* requirePermission("impersonation.start");
  const actor = yield* ImpersonationStaff;
  const command = yield* Schema.decodeEffect(ImpersonationLaunchInput)(
    input
  ).pipe(
    Effect.mapError(() => new ImpersonationFailure({ reason: "invalidInput" }))
  );
  if (!command.reason.trim()) {
    return yield* new ImpersonationFailure({ reason: "invalidInput" });
  }
  const users = yield* AuthUsers;
  const target = yield* users.getById(command.userId).pipe(
    Effect.mapError(
      (failure) =>
        new ImpersonationFailure({
          reason: failure.reason === "notFound" ? "notFound" : "unavailable",
        })
    )
  );
  if (target.user.id !== command.userId) {
    return yield* new ImpersonationFailure({ reason: "invalidData" });
  }
  const provider = yield* AuthImpersonation;
  return yield* provider.launch({
    ...command,
    actor,
    reason: command.reason.trim(),
  });
});
export const findImpersonationUsers = Effect.fn("Impersonation.findUsers")(
  function* (query: string) {
    yield* requirePermission("impersonation.read");
    if (!query.trim() || query.length > 320) {
      return yield* new ImpersonationFailure({ reason: "invalidInput" });
    }
    return yield* (yield* ImpersonationDirectory).find(query.trim());
  }
);
export const readImpersonationHistory = Effect.fn("Impersonation.history")(
  function* (input: { readonly userId: AuthUserId; readonly cursor?: string }) {
    yield* requirePermission("impersonation.read");
    const page = yield* (yield* ImpersonationAudit).list(input);
    if (page.items.some((session) => session.userId !== input.userId)) {
      return yield* new ImpersonationFailure({ reason: "invalidData" });
    }
    return page;
  }
);
