import { describe, expect, it, vi } from "vitest";

import { AuthUserId } from "./access-token";
import { makeImpersonationBrowserClient } from "./impersonation-browser-client";

const input = {
  reason: "Support request",
  userId: AuthUserId.make("customer-1"),
};
describe("Impersonation browser boundary", () => {
  it("rejects an non-HTTPS issued destination without replaying the command", async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        mode: "direct",
        url: "http://identity.example.test/one-use",
      })
    );
    const client = makeImpersonationBrowserClient(
      "https://api.example.test/impersonation",
      network
    );
    await expect(client.launch(input)).rejects.toMatchObject({
      reason: "outcomeUnknown",
    });
    expect(network).toHaveBeenCalledOnce();
  });

  it("retains a confirmed permission denial", async () => {
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ reason: "forbidden" }, { status: 403 })
      );
    await expect(
      makeImpersonationBrowserClient(
        "https://api.example.test/impersonation",
        network
      ).launch(input)
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses session records belonging to another customer", async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        coverage: "history",
        items: [
          {
            actor: { claims: {}, provider: "clerk", subject: "staff-1" },
            createdAt: "2026-11-04T00:00:00Z",
            expiresAt: "2026-11-04T01:00:00Z",
            id: "session-1",
            status: "active",
            userId: "other-customer",
          },
        ],
      })
    );
    await expect(
      makeImpersonationBrowserClient(
        "https://api.example.test/impersonation",
        network
      ).history("customer-1")
    ).rejects.toMatchObject({ reason: "invalidData" });
  });
});
