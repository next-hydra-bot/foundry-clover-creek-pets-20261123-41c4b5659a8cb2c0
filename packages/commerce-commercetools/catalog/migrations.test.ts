import { describe, expect, it } from "@effect/vitest";
import { validateCatalog } from "@repo/commerce-core/catalog";
import type { CatalogSources } from "@repo/commerce-core/catalog/files";
import { loadCatalog } from "@repo/commerce-core/catalog/files";
import { Effect } from "effect";
import { DestinationError, MigrationExecution } from "migrate-sdk";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";

import type { CatalogDestination } from "./destination";
import { makeCatalogRegistry } from "./migrations";

const fixture = (catalogs?: CatalogSources) => {
  const operations: string[] = [];
  const remote = new Map<string, string>();
  let rejectOnce: string | undefined;
  let rejectedType: string | undefined;
  const destination: CatalogDestination = {
    addProductCategories: (id, categoryIds) =>
      Effect.sync(() => {
        expect([...remote.values()]).toContain(id);
        expect(
          categoryIds.every((categoryId) => categoryId.includes(":"))
        ).toBeTruthy();
        operations.push(`memberships:${id}`);
      }),
    assignProductReferences: (product, id, relatedIds) =>
      Effect.sync(() => {
        expect(id).toBe(remote.get(product.key));
        expect(relatedIds).toEqual(
          product.relatedProductKeys.map((key) => remote.get(key))
        );
        return undefined;
      }),
    assignSelectionProduct: (id, collection) =>
      Effect.sync(() => {
        expect(collection).toMatch(/-selection$/u);
        const productKey = [...remote].find(
          ([, productId]) => productId === id
        )?.[0];
        expect(productKey).toBeDefined();
        operations.push(`selection:${productKey}`);
      }),
    upsertInventory: (sku) => Effect.succeed(`inventory:${sku}`),
    ensureProductType: (key) =>
      Effect.suspend(() => {
        operations.push("definitions");
        return key === rejectedType
          ? new DestinationError({ message: "Incompatible Product Type" })
          : Effect.succeed(`type-${key}`);
      }),
    ensureSelection: (name) =>
      Effect.sync(() => {
        operations.push(`${name}:selection`);
        return `${name}-selection`;
      }),
    upsertCategory: (name, category) =>
      Effect.sync(() => {
        operations.push(`category:${category.key}`);
        return `${name}:${category.key}`;
      }),
    upsertProduct: (name, product) =>
      Effect.suspend(() => {
        operations.push(`${name}:${product.key}`);
        const id = remote.get(product.key) ?? `product-${remote.size + 1}`;
        remote.set(product.key, id);
        if (rejectOnce === product.key) {
          rejectOnce = undefined;
          return new DestinationError({
            message: "Simulated response loss after creation",
          });
        }
        return Effect.succeed(id);
      }),
  };
  const store = InMemoryMigrationStore.layer();
  const run = (group: string, sources = catalogs) =>
    Effect.gen(function* () {
      const registry = makeCatalogRegistry({
        destination,
        store,
        catalogs: sources,
      });
      const execution = MigrationExecution.make({ registry });
      const start = yield* execution.run({ group, withDependencies: true });
      if (start.kind === "completed") {
        return start.summary;
      }
      if (start.handle === undefined) {
        return yield* Effect.die("Local execution detached");
      }
      const result = yield* start.handle.wait;
      if (result.kind !== "finished") {
        return yield* Effect.die("Execution did not finish");
      }
      return result.summary;
    });
  return {
    operations,
    rejectType: (key: string) => {
      rejectedType = key;
    },
    rejectNext: (key: string) => {
      rejectOnce = key;
    },
    remote,
    run,
  };
};

describe("catalog migrations through Migrate SDK", () => {
  it.effect("admits Products only after their own Product Type succeeds", () =>
    Effect.gen(function* () {
      const catalog = loadCatalog("b2c");
      const [{ productType }] = catalog.products;
      const state = fixture({ b2c: catalog });
      state.rejectType(productType);
      yield* state.run("b2c");
      expect(new Set(state.remote.keys())).toEqual(
        new Set(
          catalog.products
            .filter((product) => product.productType !== productType)
            .map(({ key }) => key)
        )
      );
    })
  );

  it.effect("runs category-only edits through the membership migration", () =>
    Effect.gen(function* () {
      const catalog = loadCatalog("b2c");
      const [product, ...others] = catalog.products;
      const state = fixture({ b2c: catalog });
      yield* state.run("b2c");
      const before = state.operations.length;
      yield* state.run("b2c", {
        b2c: {
          ...catalog,
          products: [
            { ...product, categoryKeys: product.categoryKeys.slice(1) },
            ...others,
          ],
        },
      });
      const changed = state.operations.slice(before);
      expect(changed).toContain(`memberships:${state.remote.get(product.key)}`);
      expect(changed).not.toContain(`b2c:${product.key}`);
    })
  );

  it.effect(
    "imports an explicitly supplied catalog under its own persistent group name",
    () =>
      Effect.gen(function* () {
        const state = fixture({ gifts: loadCatalog("b2c") });
        yield* state.run("gifts");
        expect(state.remote.size).toBe(4);
        expect(
          state.operations.some((operation) => operation.startsWith("gifts:"))
        ).toBeTruthy();
        const completed = [...state.operations];
        yield* state.run("gifts");
        expect(state.operations).toEqual(completed);
      })
  );

  for (const group of ["b2b", "b2c"] as const) {
    it.effect(
      `imports only ${group}, resolves references, and skips unchanged records on rerun`,
      () =>
        Effect.gen(function* () {
          const state = fixture();
          yield* state.run(group);
          expect(state.operations[0]).toBe("definitions");
          expect(state.remote.size).toBe(4);
          expect(
            state.operations.filter((operation) =>
              operation.startsWith("selection:")
            )
          ).toHaveLength(4);
          const first = [...state.operations];
          yield* state.run(group);
          expect(state.operations).toEqual(first);
        })
    );
  }
  it.effect(
    "retries an ambiguous product creation without duplicating products and completes pending selection membership",
    () =>
      Effect.gen(function* () {
        const state = fixture();
        state.rejectNext("outdoor-trail-jacket");
        yield* state.run("b2c");
        expect(state.operations).not.toContain(
          "selection:outdoor-trail-jacket"
        );
        yield* state.run("b2c");
        expect(state.remote.size).toBe(4);
        expect(state.operations).toContain("selection:outdoor-trail-jacket");
        expect(
          state.operations.filter((item) => item === "b2c:outdoor-trail-jacket")
        ).toHaveLength(2);
      })
  );

  it("validates missing references and duplicate SKUs before destination execution", () => {
    const { products } = loadCatalog("b2c");
    const [first] = products;
    if (first === undefined) {
      throw new Error("Fixture is empty");
    }
    expect(() =>
      validateCatalog({
        ...loadCatalog("b2c"),
        products: [{ ...first, relatedProductKeys: ["missing"] }],
      })
    ).toThrow(/Missing related/u);
    expect(() =>
      validateCatalog({
        ...loadCatalog("b2c"),
        products: [first, { ...first, key: "another-product" }],
      })
    ).toThrow(/Duplicate catalog SKU/u);
  });
});
