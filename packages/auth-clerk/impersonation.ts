import { createClerkClient } from "@clerk/nextjs/server";
import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  AuthImpersonation,
  ImpersonationAudit,
  ImpersonationDirectory,
  ImpersonationFailure,
  ImpersonationHistory,
} from "@repo/auth-contract/impersonation";
import type {
  ImpersonationLaunchInput,
  StaffActor,
} from "@repo/auth-contract/impersonation";
import { AuthUser } from "@repo/auth-contract/session";
import { Config, DateTime, Effect, Layer, Option, Schema } from "effect";

import { clerkSessionActor } from "./session";

const NativeUser = Schema.Struct({
  emailAddresses: Schema.Array(
    Schema.Struct({ emailAddress: Schema.String, id: Schema.String })
  ),
  firstName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  imageUrl: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  primaryEmailAddressId: Schema.NullOr(Schema.String),
});
const NativeSession = Schema.Struct({
  actor: Schema.NullOr(Schema.Record(Schema.String, Schema.Json)),
  createdAt: Schema.Int,
  expireAt: Schema.Int,
  id: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
});
export interface ClerkImpersonationClient {
  readonly create: (
    input: ImpersonationLaunchInput & { readonly actor: StaffActor }
  ) => Promise<{ readonly id: string; readonly url?: string | null }>;
  readonly getUser: (id: string) => Promise<typeof NativeUser.Type>;
  readonly findUsers: (
    email: string
  ) => Promise<{ readonly data: readonly (typeof NativeUser.Type)[] }>;
  readonly sessions: (
    userId: string,
    offset: number
  ) => Promise<{
    readonly data: readonly {
      readonly actor: unknown;
      readonly createdAt: number;
      readonly expireAt: number;
      readonly id: string;
      readonly status: string;
      readonly userId: string;
    }[];
    readonly totalCount: number;
  }>;
}
const request = <A>(read: () => Promise<A>, write = false) =>
  Effect.tryPromise({
    catch: (cause) => {
      const failure = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Struct({ status: Schema.Int }))(cause)
      );
      const status = failure?.status;
      let reason: ImpersonationFailure["reason"] = write
        ? "outcomeUnknown"
        : "unavailable";
      if (status === 404) {
        reason = "notFound";
      } else if (status === 400 || status === 422) {
        reason = "invalidInput";
      } else if (
        status !== undefined &&
        status >= 400 &&
        status < 500 &&
        status !== 408
      ) {
        reason = "unavailable";
      }
      return new ImpersonationFailure({ reason });
    },
    try: read,
  });
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decode native SDK replies at their transport boundary.
const decode = <A, I>(schema: Schema.Codec<A, I>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => new ImpersonationFailure({ reason: "invalidData" }))
  );
const userFrom = (user: typeof NativeUser.Type) =>
  new AuthUser({
    email:
      user.emailAddresses.find(({ id }) => id === user.primaryEmailAddressId)
        ?.emailAddress ?? null,
    firstName: user.firstName,
    id: user.id,
    lastName: user.lastName,
    profilePictureUrl: user.imageUrl,
  });
export const clerkImpersonationLayerWith = (client: ClerkImpersonationClient) =>
  Layer.mergeAll(
    Layer.succeed(AuthImpersonation, {
      launch: (input) =>
        Effect.gen(function* () {
          const response = yield* request(
            async () => await client.create(input),
            true
          );
          const token = yield* decode(
            Schema.Struct({
              id: Schema.NonEmptyString,
              url: Schema.NonEmptyString,
            }),
            response
          ).pipe(
            Effect.mapError(
              () => new ImpersonationFailure({ reason: "outcomeUnknown" })
            )
          );
          const url = yield* Effect.try({
            catch: () => new ImpersonationFailure({ reason: "outcomeUnknown" }),
            try: () => new URL(token.url),
          });
          if (url.protocol !== "https:") {
            return yield* new ImpersonationFailure({
              reason: "outcomeUnknown",
            });
          }
          return { mode: "direct" as const, url: url.href };
        }),
    }),
    Layer.succeed(ImpersonationDirectory, {
      find: (query) =>
        Effect.gen(function* () {
          const raw = yield* request(async () =>
            query.includes("@")
              ? await client.findUsers(query)
              : await client.getUser(query).then((user) => ({ data: [user] }))
          );
          const users = yield* decode(
            Schema.Struct({ data: Schema.Array(NativeUser) }),
            raw
          );
          return users.data
            .filter((user) =>
              query.includes("@")
                ? user.emailAddresses.some(
                    ({ emailAddress }) =>
                      emailAddress.toLowerCase() === query.toLowerCase()
                  )
                : user.id === query
            )
            .map(userFrom);
        }),
    }),
    Layer.succeed(ImpersonationAudit, {
      list: ({ userId, cursor }) =>
        Effect.gen(function* () {
          const offset =
            cursor === undefined
              ? 0
              : yield* Schema.decodeUnknownEffect(
                  Schema.FiniteFromString.check(
                    Schema.isInt(),
                    Schema.isGreaterThanOrEqualTo(0),
                    Schema.makeFilter(Number.isSafeInteger)
                  )
                )(cursor).pipe(
                  Effect.mapError(
                    () => new ImpersonationFailure({ reason: "invalidInput" })
                  )
                );
          const response = yield* request(
            async () => await client.sessions(userId, offset)
          );
          const page = yield* decode(
            Schema.Struct({
              data: Schema.Array(NativeSession),
              totalCount: Schema.Int,
            }),
            response
          );
          if (page.data.some((session) => session.userId !== userId)) {
            return yield* new ImpersonationFailure({ reason: "invalidData" });
          }
          return yield* Effect.try({
            catch: () => new ImpersonationFailure({ reason: "invalidData" }),
            try: () =>
              ImpersonationHistory.make({
                coverage: "history",
                items: page.data.flatMap((session) => {
                  const actor = clerkSessionActor(session.actor);
                  return actor
                    ? [
                        {
                          actor,
                          createdAt: DateTime.formatIso(
                            DateTime.makeUnsafe(session.createdAt)
                          ),
                          expiresAt: DateTime.formatIso(
                            DateTime.makeUnsafe(session.expireAt)
                          ),
                          id: session.id,
                          status: session.status,
                          userId: AuthUserId.make(session.userId),
                        },
                      ]
                    : [];
                }),
                nextCursor:
                  offset + page.data.length < page.totalCount &&
                  page.data.length > 0
                    ? String(offset + page.data.length)
                    : undefined,
              }),
          });
        }),
    })
  );
export const impersonationLayer = Layer.unwrap(
  Effect.gen(function* () {
    const secretKey = yield* Config.String("CLERK_SECRET_KEY");
    const client = createClerkClient({ secretKey });
    return clerkImpersonationLayerWith({
      create: async ({ actor: staff, reason, userId }) => {
        const actor = {
          issuer: staff.issuer,
          reason,
          session_id: staff.sessionId,
          sub: staff.subject,
        };
        return await client.actorTokens.create({
          actor,
          expiresInSeconds: 600,
          sessionMaxDurationInSeconds: 1800,
          userId,
        });
      },
      findUsers: async (email) =>
        await client.users.getUserList({ emailAddress: [email], limit: 20 }),
      getUser: async (id) => await client.users.getUser(id),
      sessions: async (userId, offset) =>
        await client.sessions.getSessionList({ limit: 20, offset, userId }),
    });
  })
);
