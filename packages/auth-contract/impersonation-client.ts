import {
  ImpersonationFailure,
  ImpersonationHistory,
  ImpersonationLaunch,
} from "@repo/auth-contract/impersonation";
import { AuthUser } from "@repo/auth-contract/session";
import { Config, Effect, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

export const impersonationAdminClient = (
  accessToken?: string,
  baseUrl?: string
) =>
  Effect.gen(function* () {
    const base = (
      baseUrl ?? (yield* Config.String("IMPERSONATION_API_URL"))
    ).replace(/\/$/u, "");
    const client = yield* HttpClient.HttpClient;
    const request = <A, I>(
      path: string,
      schema: Schema.Codec<A, I>,
      body?: { readonly userId: string; readonly reason: string }
    ) =>
      Effect.gen(function* () {
        let input = HttpClientRequest.make(body ? "POST" : "GET")(
          `${base}${path}`
        ).pipe(HttpClientRequest.acceptJson);
        if (accessToken) {
          input = HttpClientRequest.bearerToken(input, accessToken);
        }
        if (body) {
          input = yield* HttpClientRequest.bodyJson(input, body);
        }
        const response = yield* client.execute(input);
        if (response.status !== 200) {
          const failure = yield* HttpClientResponse.schemaBodyJson(
            Schema.Struct({ reason: ImpersonationFailure.fields.reason })
          )(response);
          return yield* new ImpersonationFailure(failure);
        }
        return yield* HttpClientResponse.schemaBodyJson(schema)(response);
      });
    return {
      find: (query: string) =>
        request(
          `/users?${new URLSearchParams({ query })}`,
          Schema.Struct({ users: Schema.Array(AuthUser) })
        ),
      history: (userId: string, cursor?: string) =>
        request(
          `/sessions?${new URLSearchParams(cursor ? { cursor, userId } : { userId })}`,
          ImpersonationHistory
        ),
      launch: (body: { readonly userId: string; readonly reason: string }) =>
        request("/launch", ImpersonationLaunch, body).pipe(
          Effect.mapError((error) =>
            Schema.isSchemaError(error) ||
            HttpClientError.isHttpClientError(error)
              ? new ImpersonationFailure({ reason: "outcomeUnknown" })
              : error
          )
        ),
    };
  });
