import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";

import { AccessTokenVerifier, AuthUserId } from "./access-token";
import { readBearerAuthorization } from "./http/bearer-token";
import type {
  AuthImpersonation,
  ImpersonationAudit,
  ImpersonationDirectory,
  StaffActor,
} from "./impersonation";
import {
  ImpersonationFailure,
  ImpersonationLaunchInput,
  ImpersonationStaff,
  findImpersonationUsers,
  launchImpersonation,
  readImpersonationHistory,
} from "./impersonation";
import { organizationPermissionsLayer, Permissions } from "./permissions";
import type { AuthUsers } from "./users";

export class ImpersonationAuthentication extends Context.Service<
  ImpersonationAuthentication,
  {
    readonly authenticate: (credentials: {
      readonly bearer: string;
      readonly headers: Headers;
      readonly url: string;
    }) => Effect.Effect<
      {
        readonly actor: StaffActor;
        readonly permissions: Permissions["Service"];
      },
      ImpersonationFailure
    >;
  }
>()("@repo/auth/ImpersonationAuthentication") {}

/** Supply the isolated ADMIN verifier. Customer credentials only enter the native launcher Layer. */
export const adminImpersonationAuthenticationLayer = Layer.effect(
  ImpersonationAuthentication,
  Effect.gen(function* () {
    const verifier = yield* AccessTokenVerifier;
    return ImpersonationAuthentication.of({
      authenticate: ({ bearer }) =>
        Effect.gen(function* () {
          const token = yield* verifier.verify(bearer).pipe(
            Effect.mapError(
              (error) =>
                new ImpersonationFailure({
                  reason:
                    error._tag === "AccessTokenInvalid"
                      ? "unauthorized"
                      : "unavailable",
                })
            )
          );
          if (token.actor) {
            return yield* new ImpersonationFailure({ reason: "forbidden" });
          }
          return {
            actor: {
              issuer: "admin",
              sessionId: token.sessionId,
              subject: token.authUserId,
            },
            permissions: yield* Permissions.pipe(
              Effect.provide(organizationPermissionsLayer(token))
            ),
          };
        }),
    });
  })
);

const statusFor = (reason: ImpersonationFailure["reason"]) =>
  ({
    forbidden: 403,
    invalidData: 503,
    invalidInput: 400,
    notFound: 404,
    outcomeUnknown: 503,
    unauthorized: 401,
    unavailable: 503,
  })[reason];
/** Staff adapters for other hosts can mount the same operations without the default Admin verifier. */
export const makeImpersonationHttpHandler = <E, E2>(dependencies: {
  readonly authentication: Layer.Layer<ImpersonationAuthentication, E>;
  readonly services: Layer.Layer<
    AuthImpersonation | ImpersonationAudit | ImpersonationDirectory | AuthUsers,
    E2
  >;
  readonly basePath?: string;
}) => {
  const runtime = ManagedRuntime.make(
    Layer.merge(dependencies.services, dependencies.authentication)
  );
  return {
    dispose: runtime.dispose,
    handler: async (request: Request): Promise<Response> =>
      await Effect.runPromise(
        Effect.gen(function* () {
          const credential = readBearerAuthorization(
            request.headers.get("authorization") ?? undefined
          );
          if (credential._tag !== "Token") {
            return yield* new ImpersonationFailure({ reason: "unauthorized" });
          }
          const verified =
            yield* (yield* ImpersonationAuthentication).authenticate({
              bearer: credential.token,
              headers: request.headers,
              url: request.url,
            });
          const url = new URL(request.url);
          const base = (
            dependencies.basePath ?? "/api/auth/impersonation"
          ).replace(/\/$/u, "");
          const path = url.pathname.slice(base.length);
          if (!url.pathname.startsWith(`${base}/`)) {
            return new Response(null, { status: 404 });
          }
          const program = Effect.gen(function* () {
            if (request.method === "GET" && path === "/users") {
              return Response.json({
                users: yield* findImpersonationUsers(
                  url.searchParams.get("query") ?? ""
                ),
              });
            }
            if (request.method === "GET" && path === "/sessions") {
              const input = yield* Schema.decodeUnknownEffect(
                Schema.Struct({
                  cursor: Schema.optional(
                    Schema.NonEmptyString.check(Schema.isMaxLength(1024))
                  ),
                  userId: AuthUserId,
                })
              )({
                cursor: url.searchParams.get("cursor") ?? undefined,
                userId: url.searchParams.get("userId"),
              }).pipe(
                Effect.mapError(
                  () => new ImpersonationFailure({ reason: "invalidInput" })
                )
              );
              return Response.json(yield* readImpersonationHistory(input));
            }
            if (request.method === "POST" && path === "/launch") {
              const body = yield* Effect.tryPromise({
                catch: () =>
                  new ImpersonationFailure({ reason: "invalidInput" }),
                try: async () => await request.text(),
              });
              const input = yield* Schema.decodeUnknownEffect(
                Schema.fromJsonString(ImpersonationLaunchInput)
              )(body).pipe(
                Effect.mapError(
                  () => new ImpersonationFailure({ reason: "invalidInput" })
                )
              );
              return Response.json(yield* launchImpersonation(input));
            }
            return new Response(null, { status: 404 });
          });
          return yield* program.pipe(
            Effect.provideService(Permissions, verified.permissions),
            Effect.provideService(ImpersonationStaff, verified.actor)
          );
        }).pipe(
          (program) =>
            runtime.contextEffect.pipe(
              Effect.flatMap((context) =>
                program.pipe(Effect.provideContext(context))
              )
            ),
          Effect.catch((error) =>
            Effect.succeed(
              Schema.is(ImpersonationFailure)(error)
                ? Response.json(
                    { reason: error.reason },
                    { status: statusFor(error.reason) }
                  )
                : Response.json({ reason: "unavailable" }, { status: 503 })
            )
          ),
          Effect.catchCause(() =>
            Effect.succeed(
              Response.json({ reason: "unavailable" }, { status: 503 })
            )
          ),
          Effect.map((response) => {
            response.headers.set("cache-control", "private, no-store");
            response.headers.set("referrer-policy", "no-referrer");
            return response;
          })
        )
      ),
  };
};
