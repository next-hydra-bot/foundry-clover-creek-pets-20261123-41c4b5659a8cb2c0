import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configurePortlessEnvironment } from "./portless";

const CONFIGURED_ENVIRONMENT_KEYS = [
  "ADMIN_CLERK_AUTHORIZED_PARTIES",
  "ADMIN_URL",
  "CLERK_AUTHORIZED_PARTIES",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_WEB_URL",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "PORTLESS_AUTO_ENV",
  "PORTLESS_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;
const initialEnvironment = new Map(
  CONFIGURED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
);

describe("configurePortlessEnvironment", () => {
  beforeEach(() => {
    for (const key of CONFIGURED_ENVIRONMENT_KEYS) {
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();

    for (const key of CONFIGURED_ENVIRONMENT_KEYS) {
      const initialValue = initialEnvironment.get(key);

      if (initialValue === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = initialValue;
      }
    }
  });

  it("leaves explicit development configuration unchanged outside Portless", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");

    configurePortlessEnvironment("web");

    expect(process.env.NEXT_PUBLIC_API_URL).toBe("https://api.example.test");
  });

  it("allows deliberate mixed local and remote development", () => {
    vi.stubEnv("PORTLESS_AUTO_ENV", "0");
    vi.stubEnv("PORTLESS_URL", "https://web.qa-shop.localhost");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");

    configurePortlessEnvironment("web");

    expect(process.env.NEXT_PUBLIC_API_URL).toBe("https://api.example.test");
  });

  it("wires the primary web checkout to sibling services", () => {
    vi.stubEnv("PORTLESS_URL", "https://web.qa-shop.localhost");

    configurePortlessEnvironment("web");

    expect(process.env).toMatchObject({
      ADMIN_CLERK_AUTHORIZED_PARTIES: "https://admin.qa-shop.localhost",
      ADMIN_URL: "https://admin.qa-shop.localhost",
      CLERK_AUTHORIZED_PARTIES: "https://web.qa-shop.localhost",
      NEXT_PUBLIC_API_URL: "https://api.qa-shop.localhost",
      NEXT_PUBLIC_WEB_URL: "https://web.qa-shop.localhost",
      NEXT_PUBLIC_WORKOS_REDIRECT_URI:
        "https://web.qa-shop.localhost/api/auth/callback",
      VERCEL_PROJECT_PRODUCTION_URL: "web.qa-shop.localhost",
    });
  });

  it("preserves a manually configured API origin while deriving other URLs", () => {
    vi.stubEnv("PORTLESS_URL", "https://feature.api.qa-shop.localhost");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://public-api.example.test");

    configurePortlessEnvironment("api");

    expect(process.env).toMatchObject({
      ADMIN_URL: "https://feature.admin.qa-shop.localhost",
      NEXT_PUBLIC_API_URL: "https://public-api.example.test",
      NEXT_PUBLIC_WEB_URL: "https://feature.web.qa-shop.localhost",
    });
  });

  it("preserves worktree prefixes and a custom proxy port", () => {
    vi.stubEnv(
      "PORTLESS_URL",
      "https://fix-auth.api.qa-shop.localhost:1355"
    );
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.qa-shop.localhost");

    configurePortlessEnvironment("api");

    expect(process.env).toMatchObject({
      ADMIN_URL: "https://fix-auth.admin.qa-shop.localhost:1355",
      NEXT_PUBLIC_API_URL: "https://fix-auth.api.qa-shop.localhost:1355",
      NEXT_PUBLIC_WEB_URL: "https://fix-auth.web.qa-shop.localhost:1355",
      NEXT_PUBLIC_WORKOS_REDIRECT_URI:
        "https://fix-auth.web.qa-shop.localhost:1355/api/auth/callback",
    });
  });

  it("keeps the application label distinct from a matching project label", () => {
    vi.stubEnv("PORTLESS_URL", "https://web.web.localhost");

    configurePortlessEnvironment("web");

    expect(process.env).toMatchObject({
      ADMIN_URL: "https://admin.web.localhost",
      NEXT_PUBLIC_API_URL: "https://api.web.localhost",
      NEXT_PUBLIC_WEB_URL: "https://web.web.localhost",
    });
  });

  it("keeps a matching worktree prefix distinct from the application label", () => {
    vi.stubEnv("PORTLESS_URL", "https://api.api.qa-shop.localhost");

    configurePortlessEnvironment("api");

    expect(process.env).toMatchObject({
      ADMIN_URL: "https://api.admin.qa-shop.localhost",
      NEXT_PUBLIC_API_URL: "https://api.api.qa-shop.localhost",
      NEXT_PUBLIC_WEB_URL: "https://api.web.qa-shop.localhost",
    });
  });

  it("uses the isolated admin origin for admin authentication", () => {
    vi.stubEnv("PORTLESS_URL", "https://admin.qa-shop.localhost");

    configurePortlessEnvironment("admin");

    expect(process.env.CLERK_AUTHORIZED_PARTIES).toBe(
      "https://admin.qa-shop.localhost"
    );
    expect(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI).toBe(
      "https://admin.qa-shop.localhost/api/auth/callback"
    );
  });

  it("does not rewrite configuration for an unrelated hostname", () => {
    vi.stubEnv("PORTLESS_URL", "https://different.qa-shop.localhost");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");

    configurePortlessEnvironment("web");

    expect(process.env.NEXT_PUBLIC_API_URL).toBe("https://api.example.test");
  });
});
