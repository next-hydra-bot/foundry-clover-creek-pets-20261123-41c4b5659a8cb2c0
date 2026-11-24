import { ConfigProvider, Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";

import { impersonationAdminClient } from "./impersonation-client";

const launch = async (response: Response) =>
  await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* impersonationAdminClient("admin-token")).launch({
        reason: "Support request",
        userId: "customer-1",
      });
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          IMPERSONATION_API_URL: "https://api.example.test/impersonation",
        })
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, response))
        )
      )
    )
  );
describe("Impersonation launch client", () => {
  it("keeps a confirmed permission rejection separate from uncertain issuance", async () => {
    await expect(
      launch(Response.json({ reason: "forbidden" }, { status: 403 }))
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("requires provider reconciliation after an unreadable successful write reply", async () => {
    await expect(launch(Response.json({}))).rejects.toMatchObject({
      reason: "outcomeUnknown",
    });
  });

  it("preserves a confirmed unavailable response", async () => {
    await expect(
      launch(Response.json({ reason: "unavailable" }, { status: 503 }))
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("returns the provider's declared launch mode", async () => {
    await expect(
      launch(
        Response.json({
          mode: "providerDashboard",
          url: "https://dashboard.workos.com/environment-1",
        })
      )
    ).resolves.toEqual({
      mode: "providerDashboard",
      url: "https://dashboard.workos.com/environment-1",
    });
  });
});
