// @vitest-environment node

import { NodeServices } from "@effect/platform-node";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Stdio,
  Terminal,
} from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCleanupCommand } from "../commands/cleanup";

const environment = ConfigProvider.fromUnknown({
  CTP_API_URL: "https://api.example.test",
  CTP_AUTH_URL: "https://auth.example.test",
  CTP_CLIENT_ID: "example-client",
  CTP_CLIENT_SECRET: "secret-for-fixture",
  CTP_PROJECT_KEY: "cleanup-sandbox",
  CTP_SCOPES: "manage_project:cleanup-sandbox",
});
const missingEnvironment = ConfigProvider.fromUnknown({});

const list = (results: readonly object[]) => Response.json({ results });
const run = async (
  args: readonly string[],
  route: (request: Request, url: URL) => Response | Promise<Response> = () =>
    list([]),
  {
    answer,
    config = environment,
  }: {
    readonly answer?: "enter" | "y" | "quit";
    readonly config?: ConfigProvider.ConfigProvider;
  } = {}
) => {
  const requests: string[] = [];
  const prompt: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "auth.example.test") {
      requests.push(`${request.method} ${url.pathname}`);
      return Response.json({ access_token: "token", expires_in: 3600 });
    }
    if (
      url.hostname !== "api.example.test" ||
      !url.pathname.startsWith("/cleanup-sandbox/")
    ) {
      throw new Error("Unexpected cleanup API destination");
    }
    requests.push(
      `${request.method} ${url.pathname.replace("/cleanup-sandbox", "")}`
    );
    return await route(request, url);
  };
  vi.stubGlobal("fetch", fetcher);
  return await Effect.runPromise(
    Effect.gen(function* () {
      const command = Command.runWith(
        createCleanupCommand(Effect.succeed(config)),
        { version: "0.0.0" }
      )(args);
      const terminal = yield* Terminal.Terminal;
      const input = yield* Queue.make<Terminal.UserInput, Cause.Done>();
      if (answer === "quit") {
        yield* Queue.end(input);
      } else if (answer !== undefined) {
        yield* Queue.offer(input, {
          input: answer === "enter" ? Option.none() : Option.some(answer),
          key: { name: answer, ctrl: false, meta: false, shift: false },
        });
      }
      const exit = yield* command.pipe(
        Effect.provideService(
          Terminal.Terminal,
          Terminal.make({
            ...terminal,
            readInput: Effect.succeed(input),
            display: (value) =>
              Effect.sync(() => {
                prompt.push(value);
              }),
          })
        ),
        Effect.exit
      );
      return {
        error: Exit.isFailure(exit)
          ? [
              (yield* TestConsole.errorLines).join("\n"),
              Cause.pretty(exit.cause),
            ].join("\n")
          : undefined,
        interrupted:
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        output: (yield* TestConsole.logLines).join("\n"),
        prompt: prompt.join(""),
        requests,
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          TestConsole.layer,
          Stdio.layerTest({
            stdinIsTerminal: Effect.succeed(answer !== undefined),
            stdoutIsTerminal: Effect.succeed(answer !== undefined),
          })
        )
      )
    )
  );
};

describe("commercetools cleanup CLI", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows subcommands without project credentials", async () => {
    const result = await run([], undefined, { config: missingEnvironment });
    expect(result.output).toContain("SUBCOMMANDS");
    expect(result.output).toContain("custom-objects");
    expect(result.requests).toEqual([]);
  });

  it("requires --yes for noninteractive deletion before loading credentials", async () => {
    const result = await run(["orders"], undefined, {
      config: missingEnvironment,
    });
    expect(result.error).toContain(
      "Use --yes to confirm deletion without a terminal"
    );
    expect(result.requests).toEqual([]);
  });

  it.each([
    { flag: "--yes", args: ["orders", "--yes", "--no-yes"] },
    {
      flag: "--dry-run",
      args: ["--no-dry-run", "orders", "--dry-run", "--yes"],
    },
  ])(
    "rejects repeated $flag before making requests",
    async ({ flag, args }) => {
      const result = await run(args);
      expect(result.error).toContain(`Invalid value for flag ${flag}`);
      expect(result.requests).toEqual([]);
    }
  );

  it.each([
    { args: ["orders", "--limit", "0"], error: "a positive limit" },
    {
      args: ["orders", "--batch-size", "501"],
      error: "a page size from 1 to 500",
    },
    { args: ["orders", "--where", " "], error: "a non-empty predicate" },
    {
      args: ["custom-objects", "--custom-object-container", " "],
      error: "a non-empty container key",
    },
    {
      args: [
        "custom-objects",
        "--custom-object-container",
        "one",
        "--custom-object-container",
        "two",
        "--where",
        'key="fixture"',
      ],
      error: "--where requires exactly one Custom Object container",
    },
  ])("reports $error before loading credentials", async ({ args, error }) => {
    const result = await run([...args, "--dry-run"], undefined, {
      config: missingEnvironment,
    });
    expect(result.error).toContain(error);
    expect(result.requests).toEqual([]);
  });

  it("shows the deletion target and defaults to No in a terminal", async () => {
    const result = await run(["orders"], undefined, { answer: "enter" });
    expect(result.error).toBeUndefined();
    expect(result.prompt).toContain(
      "Delete orders from cleanup-sandbox (https://api.example.test)?"
    );
    expect(result.output).toContain("Cleanup canceled.");
    expect(result.requests).toEqual([]);
  });

  it("propagates a quit at the confirmation prompt as an interruption", async () => {
    const result = await run(["orders"], undefined, { answer: "quit" });
    expect(result.interrupted).toBeTruthy();
    expect(result.requests).toEqual([]);
  });

  it("deletes the selected resource after interactive confirmation", async () => {
    const result = await run(
      ["orders"],
      (request) =>
        request.method === "DELETE"
          ? Response.json({})
          : list([{ id: "order", version: 1 }]),
      { answer: "y" }
    );
    expect(result.error).toBeUndefined();
    expect(result.requests).toEqual([
      "POST /oauth/token",
      "GET /orders",
      "DELETE /orders/order",
    ]);
  });

  it.each(["--dry-run", "--yes"])(
    "targets project resources in dependency order with all %s",
    async (flag) => {
      const deletionOrder = [
        "/orders/edits",
        "/carts",
        "/orders",
        "/shopping-lists",
        "/payments",
        "/quotes",
        "/staged-quotes",
        "/quote-requests",
        "/business-units",
        "/reviews",
        "/customers",
        "/shipping-methods",
        "/stores",
        "/zones",
        "/tax-categories",
        "/channels",
      ];
      const result = await run(
        ["all", flag, "--custom-object-container", "demo"],
        (request, url) => {
          if (request.method === "DELETE") {
            return Response.json({});
          }
          const resource = url.pathname.replace("/cleanup-sandbox", "");
          return list(
            deletionOrder.includes(resource)
              ? [{ id: "sample", key: "sample", version: 1 }]
              : []
          );
        }
      );
      expect(result.error).toBeUndefined();
      expect(result.requests).toEqual(
        expect.arrayContaining([
          "GET /orders",
          "GET /quote-requests",
          "GET /products",
          "GET /product-types",
          "GET /custom-objects/demo",
          "GET /stores",
          "GET /shipping-methods",
          "GET /zones",
          "GET /tax-categories",
          "GET /channels",
          "GET /types",
        ])
      );
      expect(
        result.requests.filter((entry) => entry.startsWith("DELETE "))
      ).toEqual(
        flag === "--dry-run"
          ? []
          : deletionOrder.map((resource) => `DELETE ${resource}/sample`)
      );
    }
  );

  it("requires a container for Custom Object cleanup", async () => {
    const result = await run(["custom-objects", "--yes"]);
    expect(result.error).toContain("--custom-object-container");
    expect(result.requests).toEqual([]);
  });

  it("keeps a dry run read-only with a native predicate and stable ID pagination", async () => {
    const predicates: string[][] = [];
    const result = await run(
      [
        "products",
        "--dry-run",
        "--yes",
        "--where",
        'key="sample"',
        "--batch-size",
        "1",
        "--limit",
        "2",
      ],
      (_request, url) => {
        predicates.push(url.searchParams.getAll("where"));
        expect(url.searchParams.get("sort")).toBe("id asc");
        return list([
          {
            id: predicates.length === 1 ? "a" : "b",
            key: "sample",
            version: 1,
          },
        ]);
      }
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("2 matched");
    expect(result.requests).toEqual([
      "POST /oauth/token",
      "GET /products",
      "GET /products",
    ]);
    expect(predicates).toEqual([
      ['key="sample"'],
      ['key="sample"', 'id > "a"'],
    ]);
  });

  it("follows the server's Order ID cursor even when UUIDs are not lexically sorted", async () => {
    const first = "ff000000-0000-4000-8000-000000000001";
    const second = "01000000-0000-4000-8000-000000000002";
    const predicates: (string | null)[] = [];
    const result = await run(
      ["orders", "--dry-run", "--batch-size", "1"],
      (_request, url) => {
        const cursor = url.searchParams.get("where");
        predicates.push(cursor);
        if (cursor === null) return list([{ id: first, version: 1 }]);
        if (cursor === `id > "${first}"`)
          return list([{ id: second, version: 1 }]);
        return list([]);
      }
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("2 matched");
    expect(predicates).toEqual([null, `id > "${first}"`, `id > "${second}"`]);
  });

  it("rejects a repeated cursor before deleting Orders", async () => {
    const result = await run(["orders", "--yes", "--batch-size", "1"], () =>
      list([{ id: "repeated-order", version: 1 }])
    );
    expect(result.error).toContain("orders returned an invalid cleanup page");
    expect(result.requests).toEqual([
      "POST /oauth/token",
      "GET /orders",
      "GET /orders",
    ]);
  });

  it("reports the provider code and detail when deleting a sample resource fails", async () => {
    const result = await run(["orders", "--yes"], (request) =>
      request.method === "GET"
        ? list([{ id: "sample-order", version: 1 }])
        : Response.json(
            {
              message: "Could not delete Order",
              errors: [
                {
                  code: "ReferenceExists",
                  message: "The Order still has a reference.",
                },
              ],
            },
            { status: 400 }
          )
    );
    expect(result.error).toContain(
      "sample-order: Delete orders failed (HTTP 400) — ReferenceExists: The Order still has a reference."
    );
  });

  it("uses only named Custom Object containers and advances through multiple pages", async () => {
    const items = [
      { id: "a", key: "one", version: 1 },
      { id: "b", key: "two", version: 1 },
    ];
    const deletedVersions: (string | null)[] = [];
    const result = await run(
      [
        "custom-objects",
        "--custom-object-container",
        "demo",
        "--batch-size",
        "1",
        "--yes",
      ],
      (request, url) => {
        if (url.pathname.endsWith("/demo")) {
          const cursor = url.searchParams.get("where");
          if (cursor === null) {
            return list(items.slice(0, 1));
          }
          return list(cursor === 'key > "one"' ? items.slice(1) : []);
        }
        const item = items.find(({ key }) => url.pathname.endsWith(`/${key}`));
        if (request.method === "DELETE") {
          deletedVersions.push(url.searchParams.get("version"));
        }
        return Response.json(item);
      }
    );
    expect(result.error).toBeUndefined();
    expect(
      result.requests.filter((entry) => entry.startsWith("DELETE "))
    ).toEqual(
      expect.arrayContaining([
        "DELETE /custom-objects/demo/one",
        "DELETE /custom-objects/demo/two",
      ])
    );
    expect(deletedVersions).toEqual(["1", "1"]);
    expect(result.output).toContain("2 deleted");
  });

  it("refuses to delete a Custom Object replaced under the same container and key", async () => {
    const object = { id: "original", key: "item", version: 1 };
    const result = await run(
      ["custom-objects", "--custom-object-container", "demo", "--yes"],
      (_request, url) =>
        url.pathname.endsWith("/demo")
          ? list([object])
          : Response.json({ ...object, id: "replacement" })
    );
    expect(result.error).toContain("Custom Object changed after listing");
    expect(
      result.requests.some((entry) => entry.startsWith("DELETE "))
    ).toBeFalsy();
  });

  it("unpublishes a product and removes its selection assignment before deletion", async () => {
    const product = {
      id: "product",
      masterData: { published: true },
      version: 4,
    };
    const deletedVersions: (string | null)[] = [];
    const updates: unknown[] = [];
    const result = await run(["products", "--yes"], async (request, url) => {
      if (request.method === "POST") {
        updates.push(await request.json());
      }
      if (url.pathname.endsWith("/products")) {
        return list([product]);
      }
      if (url.pathname.endsWith("/product-selections")) {
        return list([{ productSelection: { id: "selection" } }]);
      }
      if (url.pathname.endsWith("/selection")) {
        return Response.json({ id: "selection", version: 7 });
      }
      if (request.method === "DELETE") {
        deletedVersions.push(url.searchParams.get("version"));
      }
      return Response.json({
        ...product,
        version: request.method === "POST" ? 5 : 4,
      });
    });
    expect(result.error).toBeUndefined();
    expect(deletedVersions).toEqual(["5"]);
    expect(updates).toEqual([
      { actions: [{ action: "unpublish" }], version: 4 },
      {
        actions: [
          {
            action: "removeProduct",
            product: { id: "product", typeId: "product" },
          },
        ],
        version: 7,
      },
    ]);
    expect(result.requests.slice(1)).toEqual([
      "GET /products",
      "GET /products/product/product-selections",
      "GET /products/product",
      "POST /products/product",
      "GET /product-selections/selection",
      "POST /product-selections/selection",
      "DELETE /products/product",
    ]);
  });

  it("detaches a Product Selection from a Store before deleting the selection", async () => {
    const selection = { id: "selection", version: 7 };
    const store = {
      id: "store",
      productSelections: [{ productSelection: { id: "selection" } }],
      version: 5,
    };
    const storeUpdates: unknown[] = [];
    const result = await run(
      ["product-selections", "--yes"],
      async (request, url) => {
        if (url.pathname.endsWith("/product-selections")) {
          return list([selection]);
        }
        if (url.pathname.endsWith("/stores")) {
          return list([store]);
        }
        if (url.pathname.endsWith("/store") && request.method === "POST") {
          storeUpdates.push(await request.json());
          return Response.json({ ...store, productSelections: [], version: 6 });
        }
        return Response.json(selection);
      }
    );
    expect(result.error).toBeUndefined();
    expect(storeUpdates).toEqual([
      {
        actions: [
          {
            action: "removeProductSelection",
            productSelection: { id: "selection", typeId: "product-selection" },
          },
        ],
        version: 5,
      },
    ]);
    expect(result.requests.slice(-2)).toEqual([
      "POST /stores/store",
      "DELETE /product-selections/selection",
    ]);
  });

  it("reports version conflicts without replaying a delete", async () => {
    const result = await run(["orders", "--yes"], (request) =>
      request.method === "DELETE"
        ? Response.json({ message: "version changed" }, { status: 409 })
        : list([{ id: "order", version: 1 }])
    );
    expect(result.error).toContain("HTTP 409");
    expect(result.requests).toEqual([
      "POST /oauth/token",
      "GET /orders",
      "DELETE /orders/order",
    ]);
  });

  it("deletes Business Unit divisions before their parent", async () => {
    const result = await run(["business-units", "--yes"], (request) =>
      request.method === "DELETE"
        ? Response.json({})
        : list([
            { id: "a", key: "company", unitType: "Company", version: 1 },
            {
              id: "b",
              key: "division",
              parentUnit: { key: "company" },
              unitType: "Division",
              version: 1,
            },
          ])
    );
    expect(result.error).toBeUndefined();
    expect(result.requests.slice(-2)).toEqual([
      "DELETE /business-units/b",
      "DELETE /business-units/a",
    ]);
  });

  it("blocks a category delete that would cascade to an unselected child", async () => {
    const result = await run(
      ["categories", "--where", 'key="root"', "--yes"],
      (_request, url) =>
        list(
          url.searchParams.get("where") === 'parent(id="root")'
            ? [{ id: "child", version: 1 }]
            : [{ id: "root", key: "root", version: 1 }]
        )
    );
    expect(result.error).toContain("Category still has children");
    expect(
      result.requests.some((entry) => entry.startsWith("DELETE "))
    ).toBeFalsy();
  });
});
