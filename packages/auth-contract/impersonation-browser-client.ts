import { Effect, Result } from "effect";
import { FetchHttpClient } from "effect/http";

import { ImpersonationFailure } from "./impersonation";
import type {
  ImpersonationHistory,
  ImpersonationLaunch,
  ImpersonationLaunchInput,
} from "./impersonation";
import { impersonationAdminClient } from "./impersonation-client";
import type { AuthUser } from "./session";

export class ImpersonationRequestError extends Error {
  readonly reason: ImpersonationFailure["reason"];
  constructor(reason: ImpersonationFailure["reason"]) {
    super(
      {
        forbidden: "You do not have permission for this impersonation action.",
        invalidData: "The service returned invalid impersonation data.",
        invalidInput:
          "Enter a valid customer identity and a reason of at most 1000 characters.",
        notFound: "The customer identity no longer exists.",
        outcomeUnknown:
          "A link may have been issued, but the result could not be confirmed. Check provider records before preparing another; unconsumed tickets may not appear in session history.",
        unauthorized: "Sign in again before using impersonation.",
        unavailable:
          "The identity provider is unavailable or impersonation is not configured.",
      }[reason]
    );
    this.name = "ImpersonationRequestError";
    this.reason = reason;
  }
}
export interface ImpersonationBrowserClient {
  readonly find: (query: string) => Promise<readonly AuthUser[]>;
  readonly history: (
    userId: string,
    cursor?: string
  ) => Promise<ImpersonationHistory>;
  readonly launch: (
    input: ImpersonationLaunchInput
  ) => Promise<ImpersonationLaunch>;
}
const httpsUrl = (value: string, failure: "invalidData" | "outcomeUnknown") => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    /* Invalid remote URLs are rejected at this boundary. */
  }
  throw new ImpersonationRequestError(failure);
};
export const makeImpersonationBrowserClient = (
  baseUrl: string,
  fetcher: typeof fetch
): ImpersonationBrowserClient => {
  type Client = Effect.Success<ReturnType<typeof impersonationAdminClient>>;
  const run = async <A, E>(
    operation: (client: Client) => Effect.Effect<A, E>,
    launch = false
  ): Promise<A> => {
    let result: Result.Result<A, E>;
    try {
      result = await Effect.runPromise(
        Effect.result(
          impersonationAdminClient(undefined, baseUrl).pipe(
            Effect.orDie,
            Effect.flatMap(operation),
            Effect.provide(FetchHttpClient.layer),
            Effect.provideService(FetchHttpClient.Fetch, fetcher)
          )
        )
      );
    } catch {
      throw new ImpersonationRequestError(
        launch ? "outcomeUnknown" : "unavailable"
      );
    }
    if (Result.isSuccess(result)) {
      return result.success;
    }
    if (result.failure instanceof ImpersonationFailure) {
      throw new ImpersonationRequestError(result.failure.reason);
    }
    throw new ImpersonationRequestError(
      launch ? "outcomeUnknown" : "unavailable"
    );
  };
  return {
    find: async (query) => {
      const reply = await run((client) => client.find(query));
      return reply.users;
    },
    history: async (userId, cursor) => {
      const page = await run((client) => client.history(userId, cursor));
      if (page.items.some((session) => session.userId !== userId)) {
        throw new ImpersonationRequestError("invalidData");
      }
      if (page.auditUrl) {
        httpsUrl(page.auditUrl, "invalidData");
      }
      return page;
    },
    launch: async (input) => {
      const destination = await run((client) => client.launch(input), true);
      return {
        mode: destination.mode,
        url: httpsUrl(destination.url, "outcomeUnknown"),
      };
    },
  };
};
