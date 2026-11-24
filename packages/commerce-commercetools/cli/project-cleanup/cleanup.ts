import { Console, Effect, Schema } from "effect";

import { decodeResourceError } from "../project-provisioning/error-details";

export class ProjectCleanupError extends Schema.TaggedError<ProjectCleanupError>()(
  "ProjectCleanupError",
  { message: Schema.String, status: Schema.optional(Schema.Int) }
) {}

export const requestCleanup = <A>(
  operation: string,
  request: () => { execute: () => Promise<{ readonly body: A }> }
) =>
  Effect.tryPromise({
    catch: (cause) => {
      const { status, detail } = decodeResourceError(cause);
      const suffix = status === undefined ? "" : ` (HTTP ${status})`;
      return new ProjectCleanupError({
        message: `${operation} failed${suffix}${detail ? ` — ${detail}` : ""}`,
        status,
      });
    },
    try: async () => {
      const response = await request().execute();
      return response.body;
    },
  });

type CursorField = "id" | "key";

export type CleanupPageQuery = {
  readonly limit: number;
  readonly sort: `${CursorField} asc`;
  readonly where: string[];
  readonly withTotal: false;
};

interface Entry {
  readonly id: string;
  readonly key?: string | undefined;
}

export interface CleanupCandidate extends Entry {
  readonly hierarchy?:
    | {
        readonly key: string;
        readonly parent?: string | undefined;
      }
    | undefined;
  readonly remove: Effect.Effect<unknown, ProjectCleanupError>;
}

export interface CleanupTarget {
  readonly cursorField?: CursorField | undefined;
  readonly name: string;
  readonly sequential?: boolean | undefined;
  readonly list: (
    query: CleanupPageQuery
  ) => Effect.Effect<readonly CleanupCandidate[], ProjectCleanupError>;
}

export const listCleanupEntries = <A extends Entry>(
  name: string,
  list: (
    query: CleanupPageQuery
  ) => Effect.Effect<readonly A[], ProjectCleanupError>,
  options: {
    readonly batchSize: number;
    readonly limit: number;
    readonly where: readonly string[];
  },
  cursorField: CursorField = "id"
) =>
  Effect.gen(function* () {
    const entries: A[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    while (entries.length < options.limit) {
      const limit = Math.min(options.batchSize, options.limit - entries.length);
      const page = yield* list({
        limit,
        sort: `${cursorField} asc`,
        where:
          cursor === undefined
            ? [...options.where]
            : [...options.where, `${cursorField} > ${JSON.stringify(cursor)}`],
        withTotal: false,
      });
      const last = page.at(-1);
      if (last === undefined) {
        break;
      }
      // The service defines cursor ordering. UUID pages need not be sorted
      // lexically in JavaScript. Still fail on a missing or repeated cursor.
      const nextCursor = last[cursorField];
      const advances = page.every((entry) => {
        const value = entry[cursorField];
        if (!value || seenCursors.has(value)) {
          return false;
        }
        seenCursors.add(value);
        return true;
      });
      if (page.length > limit || nextCursor === undefined || !advances) {
        return yield* new ProjectCleanupError({
          message: `${name} returned an invalid cleanup page`,
        });
      }
      entries.push(...page);
      if (page.length < limit) {
        break;
      }
      cursor = nextCursor;
    }
    return entries;
  });

const childFirst = (entries: readonly CleanupCandidate[]) => {
  const byKey = new Map(
    entries.flatMap((entry) =>
      entry.hierarchy === undefined
        ? []
        : [[entry.hierarchy.key, entry] as const]
    )
  );
  const depths = new Map<string, number>();
  const depth = (entry: CleanupCandidate): number => {
    const known = depths.get(entry.id);
    if (known !== undefined) {
      return known;
    }
    const parent = byKey.get(entry.hierarchy?.parent ?? "");
    // Native hierarchies are acyclic. Treat a repeated node as an invalid plan.
    depths.set(entry.id, Number.NaN);
    const value = parent === undefined ? 0 : depth(parent) + 1;
    depths.set(entry.id, value);
    return value;
  };
  for (const entry of entries) {
    if (!Number.isFinite(depth(entry))) {
      return undefined;
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- Sort a copy because the TypeScript target lacks toSorted.
  return [...entries].sort(
    (a, b) => (depths.get(b.id) ?? 0) - (depths.get(a.id) ?? 0)
  );
};

const removeEntry = (entry: CleanupCandidate) =>
  entry.remove.pipe(
    Effect.as({ kind: "deleted" } as const),
    Effect.catch((error) =>
      Effect.succeed(
        error.status === 404
          ? ({ kind: "absent" } as const)
          : ({ error, id: entry.id, kind: "failed" } as const)
      )
    )
  );

export const cleanupProjectEntries = (
  targets: readonly CleanupTarget[],
  options: {
    readonly dryRun: boolean;
    readonly batchSize: number;
    readonly limit: number;
    readonly where: readonly string[];
  }
) =>
  Effect.forEach(
    targets,
    (target) =>
      Effect.gen(function* () {
        const entries = yield* listCleanupEntries(
          target.name,
          target.list,
          options,
          target.cursorField
        );
        const ordered = childFirst(entries);
        if (ordered === undefined) {
          return yield* new ProjectCleanupError({
            message: `${target.name} contains a cycle in its hierarchy`,
          });
        }
        if (options.dryRun) {
          yield* Console.log(`${target.name} — ${ordered.length} matched`);
          yield* Effect.forEach(
            ordered.slice(0, 20),
            ({ id, key }) =>
              Console.log(
                `  ${id}${key === undefined ? "" : ` (${JSON.stringify(key)})`}`
              ),
            { discard: true }
          );
          if (ordered.length > 20) {
            yield* Console.log(`  … ${ordered.length - 20} more`);
          }
          return;
        }
        const results = yield* Effect.forEach(ordered, removeEntry, {
          concurrency: target.sequential ? 1 : 5,
        });
        const failures = results.filter((result) => result.kind === "failed");
        const deleted = results.filter(({ kind }) => kind === "deleted").length;
        const absent = results.length - deleted - failures.length;
        yield* Console.log(
          `${target.name} — ${deleted} deleted, ${absent} already absent, ${failures.length} failed`
        );
        if (failures.length > 0) {
          const details = failures
            .slice(0, 10)
            .map(({ error, id }) => `  ${id}: ${error.message}`)
            .join("\n");
          return yield* new ProjectCleanupError({
            message: `${target.name} cleanup was incomplete. Review the failures and check remaining entries with --dry-run.\n${details}`,
          });
        }
      }),
    { discard: true }
  );
