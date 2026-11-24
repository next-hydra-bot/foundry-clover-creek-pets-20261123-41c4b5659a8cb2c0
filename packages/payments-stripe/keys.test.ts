// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { keys } from "./keys";

const stubValidEnvironment = () => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_publishable");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret");
};

describe("Stripe environment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"])(
    "loads the publishable key from %s",
    (name) => {
      vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "");
      vi.stubEnv(name, "pk_test_publishable");
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret");

      expect(keys()).toStrictEqual({
        STRIPE_PUBLISHABLE_KEY: "pk_test_publishable",
        STRIPE_SECRET_KEY: "sk_test_secret",
      });
    }
  );

  it.each([
    ["STRIPE_PUBLISHABLE_KEY", "sk_test_secret"],
    ["STRIPE_SECRET_KEY", "pk_test_publishable"],
  ])("rejects an invalid %s", (name, value) => {
    vi.spyOn(console, "error").mockReturnValue();
    stubValidEnvironment();
    vi.stubEnv(name, value);

    expect(keys).toThrow("Invalid environment variables");
  });

  it.each(["STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY"])(
    "names missing %s in the startup diagnostic",
    (name) => {
      const consoleError = vi.spyOn(console, "error").mockReturnValue();
      stubValidEnvironment();
      vi.stubEnv(name, "");

      expect(keys).toThrow("Invalid environment variables");
      expect(consoleError).toHaveBeenCalledWith(
        "❌ Invalid environment variables:",
        expect.arrayContaining([expect.objectContaining({ path: [name] })])
      );
    }
  );
});
