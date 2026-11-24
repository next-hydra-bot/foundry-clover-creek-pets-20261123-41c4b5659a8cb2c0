import { isDeepStrictEqual } from "node:util";

import { Effect, Schema } from "effect";

import type { AlgoliaAdministration } from "./administration";
import type { SearchAdministrationClient } from "./administration-live-clients";
import { tryClient } from "./administration-live-shared";

type IndexAdministration = Pick<
  AlgoliaAdministration["Service"],
  "configureIndex"
>;

const isMissingIndex = Schema.is(
  Schema.Struct({ status: Schema.Literal(404) })
);

export const algoliaIndexAdministration = (
  search: SearchAdministrationClient
): IndexAdministration => ({
  configureIndex: Effect.fn("AlgoliaAdministration.configureIndex")(function* ({
    indexName,
    settings,
  }) {
    const existing = yield* tryClient(
      "index settings lookup",
      async () => await search.getSettings({ indexName })
    ).pipe(
      Effect.catch((error) =>
        isMissingIndex(error.cause)
          ? Effect.succeed(undefined)
          : Effect.fail(error)
      )
    );
    if (existing !== undefined) {
      const current = new Map(Object.entries(existing));
      if (
        Object.entries(settings).every(([key, value]) =>
          isDeepStrictEqual(current.get(key), value)
        )
      ) {
        return;
      }
    }
    const response = yield* tryClient(
      "index settings update",
      async () =>
        await search.setSettings({ indexName, indexSettings: settings })
    );
    if (response.taskID !== undefined) {
      yield* tryClient(
        "index settings task",
        async () =>
          await search.waitForTask({ indexName, taskID: response.taskID })
      );
    }
  }),
});
