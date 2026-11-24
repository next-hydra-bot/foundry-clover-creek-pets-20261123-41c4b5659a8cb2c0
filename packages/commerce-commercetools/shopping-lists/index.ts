import type {
  ByProjectKeyRequestBuilder,
  ShoppingList as NativeList,
  ShoppingListUpdateAction,
} from "@commercetools/platform-sdk";
import {
  ShoppingListBuyer,
  DeleteShoppingListInput,
  ListShoppingListsInput,
  ShoppingList,
  ShoppingListDraft,
  ShoppingListFailure,
  ShoppingListId,
  ShoppingListRevision,
  ShoppingListSummary,
  ShoppingListReadInput,
  UpdateShoppingListInput,
} from "@repo/commerce-core/domain/shopping-list";
import {
  changeShoppingList,
  ownsShoppingList,
  readShoppingListCursor,
  shoppingListCursor,
  shoppingListOwnership,
} from "@repo/commerce-core/domain/shopping-list-operations";
import { ShoppingLists } from "@repo/commerce-core/services/shopping-lists";
import { Clock, DateTime, Effect, Layer, Option, Schema } from "effect";

import { commercetoolsRestClientLayer } from "../client/layers";
import { CommercetoolsRestClient } from "../client/rest-client";
import {
  isCommercetoolsAccessDenied,
  isCommercetoolsClientFailure,
  isConcurrentModification,
  hasCommercetoolsErrorCode,
} from "../client/versioned-write";
import {
  resolveVariantReference,
  variantReference,
} from "../product/variant-reference";

const failure =
  (operation: ShoppingListFailure["operation"]) => (cause: unknown) =>
    cause instanceof ShoppingListFailure
      ? new ShoppingListFailure({
          cause: cause.cause,
          message: cause.message,
          reason: cause.reason,
          operation,
        })
      : new ShoppingListFailure({
          cause,
          operation,
          message:
            "Shopping lists could not be read or changed in commercetools.",
          reason:
            cause instanceof Schema.SchemaError
              ? "invalidData"
              : isCommercetoolsAccessDenied(cause) ||
                  hasCommercetoolsErrorCode(
                    cause,
                    "AssociateMissingPermission",
                    "AssociateIsNotAssignedToBusinessUnit"
                  )
                ? "accessDenied"
                : isConcurrentModification(cause) ||
                    hasCommercetoolsErrorCode(cause, "DuplicateField")
                  ? "conflict"
                  : hasCommercetoolsErrorCode(cause, "ResourceNotFound") ||
                      Schema.is(
                        Schema.Struct({ statusCode: Schema.Literal(404) })
                      )(cause)
                    ? "notFound"
                    : isCommercetoolsClientFailure(cause)
                      ? "invalidInput"
                      : operation === "get" || operation === "list"
                        ? "unavailable"
                        : "outcomeUnknown",
        });
type NativeBuyer = ShoppingListBuyer & { readonly customerId: string };

const quote = (value: string) => JSON.stringify(value);
/** Native keys are project-global; native customer/company UUIDs disambiguate each Store-scoped list. */
const favoritesKey = (
  principal: NativeBuyer,
  storeKey: string,
  customerId: string = principal.customerId
) =>
  principal.businessUnit !== undefined
    ? `favorites_company_${storeKey}_${principal.businessUnit.id}_${customerId}`
    : `favorites_customer_${storeKey}_${customerId}`;
const purpose = (principal: NativeBuyer, native: NativeList) =>
  native.customer &&
  native.key ===
    favoritesKey(principal, native.store?.key ?? "", native.customer.id)
    ? ("favorites" as const)
    : ("shopping" as const);
const request = (
  api: ByProjectKeyRequestBuilder,
  principal: NativeBuyer,
  storeKey: string
) =>
  principal.businessUnit === undefined
    ? api.inStoreKeyWithStoreKeyValue({ storeKey }).shoppingLists()
    : api
        .asAssociate()
        .withAssociateIdValue({ associateId: principal.customerId })
        .inBusinessUnitKeyWithBusinessUnitKeyValue({
          businessUnitKey: principal.businessUnit.key,
        })
        .shoppingLists();
const fromNative = (principal: NativeBuyer, native: NativeList) =>
  Effect.try({
    try: () => ({
      id: native.id,
      revision: String(native.version),
      storeKey: native.store?.key,
      purpose: purpose(principal, native),
      ownership: native.businessUnit
        ? {
            _tag: "BusinessUnit",
            businessUnitId:
              principal.businessUnit !== undefined &&
              native.businessUnit.key === principal.businessUnit.key
                ? principal.businessUnit.id
                : undefined,
            authUserId:
              native.customer?.id === principal.customerId
                ? principal.authUserId
                : undefined,
          }
        : {
            _tag: "Customer",
            authUserId:
              native.customer?.id === principal.customerId
                ? principal.authUserId
                : undefined,
          },
      name: native.name,
      description: native.description,
      createdAt: new Date(native.createdAt),
      updatedAt: new Date(native.lastModifiedAt),
      items: native.lineItems.map((line) => ({
        id: line.id,
        variantId: variantReference(
          line.productId,
          line.variantId ?? line.variant?.id ?? 0
        ),
        quantity: line.quantity,
        addedAt: new Date(line.addedAt),
      })),
    }),
    catch: failure("get"),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ShoppingList)));
const nativeVariant = (
  variantId: Parameters<typeof resolveVariantReference>[0]
): Effect.Effect<
  { readonly productId: string; readonly variantId: number },
  ShoppingListFailure
> => {
  const reference = resolveVariantReference(variantId);
  return Option.isSome(reference)
    ? Effect.succeed(reference.value)
    : Effect.fail(
        new ShoppingListFailure({
          operation: "update",
          reason: "invalidInput",
          message:
            "The saved variant reference is not a commercetools variant.",
        })
      );
};
const nativeVersion = (revision: string, operation: "update" | "delete") =>
  /^[1-9]\d*$/u.test(revision) && Number.isSafeInteger(Number(revision))
    ? Effect.succeed(Number(revision))
    : Effect.fail(
        new ShoppingListFailure({
          operation,
          reason: "invalidInput",
          message: "The shopping list revision is invalid.",
        })
      );
const guardLimit = (list: ShoppingList, operation: "create" | "update") =>
  list.items.length <= 250
    ? Effect.void
    : Effect.fail(
        new ShoppingListFailure({
          operation,
          reason: "limitExceeded",
          message:
            "A commercetools shopping list can contain at most 250 product lines.",
        })
      );

export const shoppingListsLayerWithClient = Layer.effect(
  ShoppingLists,
  Effect.gen(function* () {
    const { apiRoot } = yield* CommercetoolsRestClient;
    const resolveBuyer = Effect.fn("CommercetoolsShoppingLists.resolveBuyer")(
      function* (buyer: ShoppingListBuyer) {
        const response = yield* Effect.tryPromise({
          try: () =>
            apiRoot
              .customers()
              .get({
                queryArgs: {
                  where: `externalId=${quote(buyer.authUserId)}`,
                  limit: 2,
                },
              })
              .execute(),
          catch: failure("get"),
        });
        const [customer] = response.body.results;
        if (
          !customer ||
          response.body.results.length !== 1 ||
          customer.externalId !== buyer.authUserId
        ) {
          return yield* new ShoppingListFailure({
            operation: "get",
            reason: "accessDenied",
            message: "The authenticated user has no linked commerce customer.",
          });
        }
        return { ...buyer, customerId: customer.id };
      }
    );
    const get = Effect.fn("CommercetoolsShoppingLists.get")(
      function* (
        principal: NativeBuyer,
        input: typeof ShoppingListReadInput.Type
      ) {
        const native = yield* Effect.tryPromise({
          try: async () => {
            const endpoint = request(apiRoot, principal, input.storeKey);
            if (!("id" in input) || principal.businessUnit !== undefined) {
              const lookup =
                "id" in input
                  ? `id=${quote(input.id)}`
                  : `key=${quote(favoritesKey(principal, input.storeKey))}`;
              const predicates = [
                lookup,
                `store(key=${quote(input.storeKey)})`,
              ];
              if (principal.businessUnit !== undefined)
                predicates.push(
                  `businessUnit(key=${quote(principal.businessUnit.key)})`
                );
              if (!("id" in input))
                predicates.push(`customer(id=${quote(principal.customerId)})`);
              const response = await endpoint
                .get({
                  queryArgs: {
                    where: predicates,
                    limit: 1,
                    withTotal: false,
                    expand: ["lineItems[*].variant"],
                  },
                })
                .execute();
              return response.body.results[0];
            }
            const response = await endpoint
              .withId({ ID: input.id })
              .get({ queryArgs: { expand: ["lineItems[*].variant"] } })
              .execute();
            return response.body;
          },
          catch: failure("get"),
        }).pipe(
          Effect.map(Option.fromUndefinedOr),
          Effect.catchTag("ShoppingListFailure", (error) =>
            error.reason === "notFound"
              ? Effect.succeed(Option.none<NativeList>())
              : Effect.fail(error)
          )
        );
        if (Option.isNone(native)) return Option.none<ShoppingList>();
        // Check native scope before projecting provider Business Unit identity.
        const row = native.value;
        if (
          row.store?.key !== input.storeKey ||
          (principal.businessUnit === undefined
            ? row.businessUnit !== undefined ||
              row.customer?.id !== principal.customerId
            : row.businessUnit?.key !== principal.businessUnit.key)
        )
          return Option.none<ShoppingList>();
        const list = yield* fromNative(principal, row);
        return ownsShoppingList(principal, input, list)
          ? Option.some(list)
          : Option.none<ShoppingList>();
      },
      Effect.mapError(failure("get"))
    );
    const requireCurrent = Effect.fn(
      "CommercetoolsShoppingLists.requireCurrent"
    )(function* (
      principal: NativeBuyer,
      input: typeof DeleteShoppingListInput.Type,
      operation: "update" | "delete"
    ) {
      const found = yield* get(principal, input);
      if (Option.isNone(found))
        return yield* new ShoppingListFailure({
          operation,
          reason: "notFound",
          message: "The shopping list was not found.",
        });
      if (found.value.revision !== input.expectedRevision)
        return yield* new ShoppingListFailure({
          operation,
          reason: "conflict",
          message: "The shopping list changed. Reload it before saving.",
        });
      return found.value;
    });
    return ShoppingLists.of({
      get: Effect.fn("CommercetoolsShoppingLists.read")((buyer, input) =>
        resolveBuyer(buyer).pipe(
          Effect.flatMap((principal) => get(principal, input))
        )
      ),
      list: Effect.fn("CommercetoolsShoppingLists.list")(
        function* (buyer, raw) {
          const principal = yield* resolveBuyer(buyer);
          const input = yield* Schema.decodeUnknownEffect(
            ListShoppingListsInput
          )(raw).pipe(
            Effect.mapError(
              (cause) =>
                new ShoppingListFailure({
                  cause,
                  operation: "list",
                  reason: "invalidInput",
                  message: "Invalid shopping list query.",
                })
            )
          );
          const cursor = yield* readShoppingListCursor(input.cursor);
          const predicates = [
            `store(key=${quote(input.storeKey)})`,
            principal.businessUnit === undefined
              ? `customer(id=${quote(principal.customerId)}) and businessUnit is not defined`
              : `businessUnit(key=${quote(principal.businessUnit.key)})`,
          ];
          if (input.ownership === "mine")
            predicates.push(`customer(id=${quote(principal.customerId)})`);
          if (input.ownership === "others")
            predicates.push(
              `(customer is not defined or customer(id!=${quote(principal.customerId)}))`
            );
          if (cursor) {
            const date = quote(DateTime.formatIso(cursor.createdAt));
            predicates.push(
              `(createdAt < ${date} or (createdAt = ${date} and id < ${quote(cursor.id)}))`
            );
          }
          const response = yield* Effect.tryPromise({
            try: () =>
              request(apiRoot, principal, input.storeKey)
                .get({
                  queryArgs: {
                    where: predicates,
                    sort: ["createdAt desc", "id desc"],
                    limit: input.limit + 1,
                    withTotal: false,
                  },
                })
                .execute(),
            catch: failure("list"),
          });
          const summaries = yield* Effect.forEach(
            response.body.results.slice(0, input.limit),
            (row) =>
              Schema.decodeUnknownEffect(ShoppingListSummary)({
                id: row.id,
                revision: String(row.version),
                storeKey: row.store?.key,
                purpose: purpose(principal, row),
                ownership: row.businessUnit
                  ? {
                      _tag: "BusinessUnit",
                      businessUnitId:
                        principal.businessUnit !== undefined &&
                        row.businessUnit.key === principal.businessUnit.key
                          ? principal.businessUnit.id
                          : undefined,
                      authUserId:
                        row.customer?.id === principal.customerId
                          ? principal.authUserId
                          : undefined,
                    }
                  : {
                      _tag: "Customer",
                      authUserId:
                        row.customer?.id === principal.customerId
                          ? principal.authUserId
                          : undefined,
                    },
                name: row.name,
                description: row.description,
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.lastModifiedAt),
                itemCount: row.lineItems.length,
              })
          );
          const last = summaries.at(-1);
          return {
            items: summaries,
            ...(response.body.results.length > input.limit && last
              ? { nextCursor: shoppingListCursor(last) }
              : {}),
          };
        },
        Effect.mapError(failure("list"))
      ),
      create: Effect.fn("CommercetoolsShoppingLists.create")(
        function* (buyer, raw) {
          const principal = yield* resolveBuyer(buyer);
          const draft = yield* Schema.decodeUnknownEffect(ShoppingListDraft)(
            raw
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ShoppingListFailure({
                  cause,
                  operation: "create",
                  reason: "invalidInput",
                  message: "Invalid shopping list.",
                })
            )
          );
          const now = new Date(yield* Clock.currentTimeMillis);
          const seed: ShoppingList = {
            ...draft,
            purpose: draft.purpose ?? "shopping",
            items: [],
            id: ShoppingListId.make("new"),
            revision: ShoppingListRevision.make("new"),
            ownership: shoppingListOwnership(principal),
            createdAt: now,
            updatedAt: now,
          };
          const normalized = yield* changeShoppingList(
            seed,
            draft.items.map((item) => ({ _tag: "AddItem", ...item })),
            principal.authUserId,
            now
          );
          yield* guardLimit(normalized, "create");
          const lineItems = yield* Effect.forEach(normalized.items, (item) =>
            nativeVariant(item.variantId).pipe(
              Effect.map((reference) => ({
                ...reference,
                quantity: item.quantity,
              }))
            )
          );
          const response = yield* Effect.tryPromise({
            try: () =>
              request(apiRoot, principal, draft.storeKey)
                .post({
                  body: {
                    key:
                      draft.purpose === "favorites"
                        ? favoritesKey(principal, draft.storeKey)
                        : undefined,
                    name: draft.name,
                    ...(draft.description
                      ? { description: draft.description }
                      : {}),
                    store: { typeId: "store", key: draft.storeKey },
                    customer: { typeId: "customer", id: principal.customerId },
                    ...(principal.businessUnit !== undefined
                      ? {
                          businessUnit: {
                            typeId: "business-unit",
                            key: principal.businessUnit.key,
                          },
                        }
                      : {}),
                    lineItems,
                  },
                })
                .execute(),
            catch: failure("create"),
          });
          return yield* fromNative(principal, response.body).pipe(
            Effect.mapError(
              (cause) =>
                new ShoppingListFailure({
                  cause,
                  operation: "create",
                  reason: "outcomeUnknown",
                  message:
                    "The list may have been saved, but its response could not be read. Refresh before retrying.",
                })
            )
          );
        },
        Effect.mapError(failure("create"))
      ),
      update: Effect.fn("CommercetoolsShoppingLists.update")(
        function* (buyer, raw) {
          const principal = yield* resolveBuyer(buyer);
          const input = yield* Schema.decodeUnknownEffect(
            UpdateShoppingListInput
          )(raw).pipe(
            Effect.mapError(
              (cause) =>
                new ShoppingListFailure({
                  cause,
                  operation: "update",
                  reason: "invalidInput",
                  message: "Invalid shopping list update.",
                })
            )
          );
          const current = yield* requireCurrent(principal, input, "update");
          const next = yield* changeShoppingList(
            current,
            input.actions,
            principal.authUserId,
            new Date(yield* Clock.currentTimeMillis)
          );
          yield* guardLimit(next, "update");
          const actions: ShoppingListUpdateAction[] = [];
          if (input.actions.some((action) => action._tag === "SetName"))
            actions.push({ action: "changeName", name: next.name });
          if (input.actions.some((action) => action._tag === "SetDescription"))
            actions.push({
              action: "setDescription",
              ...(next.description ? { description: next.description } : {}),
            });
          for (const line of current.items) {
            const saved = next.items.find((item) => item.id === line.id);
            if (!saved)
              actions.push({ action: "removeLineItem", lineItemId: line.id });
            else if (saved.quantity !== line.quantity)
              actions.push({
                action: "changeLineItemQuantity",
                lineItemId: line.id,
                quantity: saved.quantity,
              });
          }
          for (const line of next.items)
            if (!current.items.some((item) => item.id === line.id)) {
              actions.push({
                action: "addLineItem",
                ...(yield* nativeVariant(line.variantId)),
                quantity: line.quantity,
              });
            }
          if (!actions.length)
            actions.push({ action: "changeName", name: current.name });
          const version = yield* nativeVersion(
            input.expectedRevision,
            "update"
          );
          const response = yield* Effect.tryPromise({
            try: () =>
              request(apiRoot, principal, input.storeKey)
                .withId({ ID: input.id })
                .post({ body: { version, actions } })
                .execute(),
            catch: failure("update"),
          });
          return yield* fromNative(principal, response.body).pipe(
            Effect.mapError(
              (cause) =>
                new ShoppingListFailure({
                  cause,
                  operation: "update",
                  reason: "outcomeUnknown",
                  message:
                    "The list may have been saved, but its response could not be read. Refresh before retrying.",
                })
            )
          );
        },
        Effect.mapError(failure("update"))
      ),
      delete: Effect.fn("CommercetoolsShoppingLists.delete")(
        function* (buyer, raw) {
          const principal = yield* resolveBuyer(buyer);
          const input = yield* Schema.decodeUnknownEffect(
            DeleteShoppingListInput
          )(raw).pipe(
            Effect.mapError(
              (cause) =>
                new ShoppingListFailure({
                  cause,
                  operation: "delete",
                  reason: "invalidInput",
                  message: "Invalid shopping list deletion.",
                })
            )
          );
          yield* requireCurrent(principal, input, "delete");
          const version = yield* nativeVersion(
            input.expectedRevision,
            "delete"
          );
          yield* Effect.tryPromise({
            try: () =>
              request(apiRoot, principal, input.storeKey)
                .withId({ ID: input.id })
                .delete({ queryArgs: { version } })
                .execute(),
            catch: failure("delete"),
          });
        },
        Effect.mapError(failure("delete"))
      ),
    });
  })
);
export const shoppingListsLayer = shoppingListsLayerWithClient.pipe(
  Layer.provide(commercetoolsRestClientLayer)
);
