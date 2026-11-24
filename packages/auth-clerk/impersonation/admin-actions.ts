import "server-only";
import {
  ImpersonationFailure,
  ImpersonationLaunchInput,
} from "@repo/auth-contract/impersonation";
import { impersonationAdminClient } from "@repo/auth-contract/impersonation-client";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import type { ImpersonationActionResult } from "./launch-form";

export const submitImpersonation = async (
  form: FormData,
  token: string | undefined
): Promise<ImpersonationActionResult> =>
  await Effect.runPromise(
    Effect.gen(function* () {
      if (!token) {
        return { error: "Sign in again before starting impersonation." };
      }
      const input = yield* Schema.decodeUnknownEffect(ImpersonationLaunchInput)(
        { reason: form.get("reason"), userId: form.get("userId") }
      ).pipe(
        Effect.mapError(
          () => new ImpersonationFailure({ reason: "invalidInput" })
        )
      );
      const client = yield* impersonationAdminClient(token);
      return { destination: yield* client.launch(input) };
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          error: Schema.is(ImpersonationFailure)(error)
            ? {
                unauthorized: "Sign in again before starting impersonation.",
                forbidden: "You do not have permission to start impersonation.",
                invalidInput:
                  "Enter a customer identity and a non-empty reason of at most 1000 characters.",
                notFound: "The customer identity no longer exists.",
                unavailable:
                  "The identity provider is unavailable or impersonation is not enabled. Check its configuration.",
                invalidData:
                  "The identity provider returned an invalid response.",
                outcomeUnknown:
                  "A link may have been issued, but the result could not be confirmed. Check provider records before preparing another link; unconsumed tickets do not appear in session history.",
              }[error.reason]
            : "Customer impersonation is unavailable. Check API configuration and access.",
        })
      ),
      Effect.provide(FetchHttpClient.layer)
    )
  );
