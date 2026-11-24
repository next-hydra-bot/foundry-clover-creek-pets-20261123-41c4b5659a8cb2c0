import {
  AccessTokenInvalid,
  AccessTokenVerifier,
  AuthUserId as TokenAuthUserId,
  VerifiedAccessToken,
} from "@repo/auth-contract/access-token";
import { PermissionAdapter } from "@repo/auth-contract/permissions";
import { CartPublicState } from "@repo/commerce-core/cart/public-state";
import {
  AddressBookAccessDenied,
  AddressBookProviderFailure,
} from "@repo/commerce-core/domain/address-book";
import { CartId, ProductId, VariantId } from "@repo/commerce-core/domain/cart";
import { CartWriteOutcomeUnknown } from "@repo/commerce-core/domain/cart-errors";
import { ProductTypeKey } from "@repo/commerce-core/domain/cart-snapshot";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceBusinessUnitLabel,
  CommerceBusinessUnitMembership,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AnonymousCommercePrincipal,
  B2CPurchasingPrincipal,
  CustomerCommercePrincipal,
  CommerceRequestContextNotFound,
} from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { ListOrdersInput } from "@repo/commerce-core/domain/order-history";
import { ANONYMOUS_CART_COOKIE_NAME } from "@repo/commerce-core/lib/cart/utils/anonymous-cart-cookies";
import { ProductDiscovery } from "@repo/commerce-core/product/product-discovery";
import type { CommerceBaseStableServices } from "@repo/commerce-core/runtime/make-commerce-base-app";
import { makeCommerceBaseApp } from "@repo/commerce-core/runtime/make-commerce-base-app";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import type { AddressBookListFailure } from "@repo/commerce-core/services/address-book";
import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { Carts } from "@repo/commerce-core/services/carts";
import { CommerceAccounts } from "@repo/commerce-core/services/commerce-accounts";
import { CommerceBuyerAccounts } from "@repo/commerce-core/services/commerce-buyer-accounts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import { Effect, Layer, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { accountContextLayerWith } from "./account-context";
import { makeCommerceHttpHandler } from "./runtime";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const profileUnavailable = () =>
  new CommerceRequestContextNotFound({
    message: "Unused profile",
    reason: "noPrincipal",
  });
const principalFor = (request: CommerceContextRequest) => {
  const customerId = CommerceCustomerId.make("customer-1");
  if (request._tag === "AnonymousCommerceContextRequest") {
    return new AnonymousCommercePrincipal({
      anonymousCartId: request.anonymousCartId,
    });
  }
  if (request._tag === "B2CPurchasingContextRequest") {
    return new B2CPurchasingPrincipal({
      authUserId: request.authUserId,
      customerId,
    });
  }
  return new CustomerCommercePrincipal({
    authUserId: request.authUserId,
    businessUnitId:
      request.businessUnitId ?? CommerceBusinessUnitId.make("missing"),
    businessUnitKey: CommerceBusinessUnitKey.make(
      request.businessUnitId ?? "missing"
    ),
    customerId,
    roles: ["buyer"],
  });
};

const fixture = (
  uncertain = false,
  basePath?: `/${string}`,
  addressFailure?: AddressBookListFailure,
  purchasingMode: "b2c" | "b2b" = "b2c"
) => {
  const addressReads: string[] = [];
  const contexts: CommerceContextRequest[] = [];
  const orderReads: {
    input: ListOrdersInput;
    principal: string;
    companyPermission: boolean | undefined;
  }[] = [];
  const orderPrograms = {
    findOrderDetail: () => Effect.succeed(Option.none()),
    listOrders: (input: ListOrdersInput) =>
      Effect.gen(function* () {
        const { principal } = yield* CommerceContext;
        const adapter = yield* PermissionAdapter;
        const companyPermission =
          principal._tag === "CustomerCommercePrincipal"
            ? yield* adapter.has(
                {
                  authUserId: principal.authUserId,
                  scope: {
                    id: principal.businessUnitId,
                    type: "business-unit",
                  },
                },
                "company.orders.read"
              )
            : undefined;
        orderReads.push({
          companyPermission,
          input,
          principal: principal._tag,
        });
        return { items: [] };
      }),
  };
  const accounts = CommerceAccounts.layerMemoryFrom({
    customers: [
      {
        authUserId: TokenAuthUserId.make("user-1"),
        customerId: CommerceCustomerId.make("customer-1"),
      },
    ],
  });
  const stable: Layer.Layer<CommerceBaseStableServices> = Layer.mergeAll(
    accounts,
    CommerceBuyerAccounts.layerFromAccounts.pipe(Layer.provide(accounts)),
    CartPolicies.layerFrom([]),
    Carts.layerMemory({
      failures: uncertain
        ? {
            addItem: new CartWriteOutcomeUnknown({
              cartId: CartId.make("cart-1"),
              operation: "addItem",
            }),
          }
        : undefined,
      merchandise: [
        {
          unitPrice: { centAmount: 1200, currencyCode: "USD" },
          variant: {
            id: VariantId.make("opaque/purchase:reference"),
            images: [],
            name: "Wrench",
            productId: ProductId.make("product-1"),
            productType: Schema.decodeSync(ProductTypeKey)("generic-product"),
          },
        },
      ],
    })
  );
  const commerce = makeCommerceBaseApp<
    CommerceBaseStableServices,
    never,
    never,
    never,
    never
  >({
    commerceContextLayer: (request) =>
      Layer.effect(
        CommerceContext,
        Effect.sync(() => {
          contexts.push(request);
          const principal = principalFor(request);
          return CommerceContext.of({
            customerPrincipal: () =>
              principal._tag === "AnonymousCommercePrincipal"
                ? Effect.fail(profileUnavailable())
                : Effect.succeed(principal),
            customerProfile: () => Effect.fail(profileUnavailable()),
            principal,
            store: request.store,
          });
        })
      ),
    currentCartLayer: (request) => CurrentCart.layer(request.currentCartCookie),
    layer: stable,
    productDiscoveryLayer: ProductDiscovery.testLayer(),
  });
  const transport = makeCommerceHttpHandler({
    addressBookLayer: Layer.effect(
      AddressBook,
      Effect.gen(function* () {
        const { principal } = yield* CommerceContext;
        return AddressBook.of({
          change: () => Effect.die("Address changes are not used in this test"),
          list: () =>
            Effect.sync(() => {
              addressReads.push(
                principal._tag === "CustomerCommercePrincipal"
                  ? principal.businessUnitId
                  : "personal"
              );
            }).pipe(
              Effect.andThen(
                addressFailure === undefined
                  ? Effect.succeed([])
                  : Effect.fail(addressFailure)
              )
            ),
          get: () => Effect.die("Unused address detail"),
          save: () => Effect.die("Unused address write"),
        });
      })
    ),
    authenticationLayer: Layer.succeed(AccessTokenVerifier, {
      verify: (token) =>
        token === "valid"
          ? Effect.succeed(
              new VerifiedAccessToken({
                authUserId: TokenAuthUserId.make("user-1"),
                permissionGrants: {
                  version: 1,
                  grants: [
                    {
                      scope: { type: "business-unit", id: "company-1" },
                      permissions: ["company.orders.read"],
                    },
                  ],
                },
              })
            )
          : Effect.fail(
              new AccessTokenInvalid({
                message: "Invalid",
                reason: "invalidToken",
              })
            ),
    }),
    basePath,
    commerceApp: commerce,
    accountContextLayer: Layer.unwrap(
      CommerceAccounts.pipe(
        Effect.map((account) =>
          accountContextLayerWith(account, (_customerId, businessUnitId) =>
            Effect.succeed(
              ["company-1", "company-2"].includes(businessUnitId)
                ? Option.some(
                    new CommerceBusinessUnitMembership({
                      businessUnitId,
                      businessUnitKey:
                        CommerceBusinessUnitKey.make(businessUnitId),
                      businessUnitLabel:
                        CommerceBusinessUnitLabel.make(businessUnitId),
                      roles: ["buyer"],
                    })
                  )
                : Option.none()
            )
          )
        )
      )
    ).pipe(Layer.provide(accounts)),
    orderPrograms:
      purchasingMode === "b2b"
        ? { company: orderPrograms }
        : { personal: orderPrograms },
    purchasingMode,
    ordersLayer: Layer.succeed(OrderQueries, {
      findById: () => Effect.die("Unused native Order fixture"),
      list: () => Effect.die("Unused native Order fixture"),
    }),
  });
  let cookie: string | undefined;
  const send = async (
    path: string,
    method = "GET",
    body?: Schema.Json,
    headers: Record<string, string> = {}
  ) => {
    const requestHeaders = new Headers({
      "content-type": "application/json",
      "x-context-locale": "en-US",
      ...headers,
    });
    if (cookie) {
      requestHeaders.set("cookie", cookie);
    }
    const init: RequestInit = { headers: requestHeaders, method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const response = await transport.handler(
      new Request(`https://api.example${basePath ?? ""}${path}`, init)
    );
    const updated = response.headers.get("set-cookie");
    if (updated) {
      [cookie] = updated.split(";");
    }
    return response;
  };
  return {
    addressReads,
    contexts,
    cookie: () => cookie,
    orderReads,
    send,
    transport,
  };
};
const item = { quantity: 1, variantId: "opaque/purchase:reference" };
const personal = {
  authorization: "Bearer valid",
  "x-context-purchasing-context": "personal",
};
const company = {
  authorization: "Bearer valid",
  "x-context-business-unit-id": "company-1",
  "x-context-purchasing-context": "company",
};

const statusOf = async (response: Promise<Response>) => {
  const resolved = await response;
  return resolved.status;
};
const readCart = async (response: Promise<Response>) => {
  const resolved = await response;
  return Schema.decodeUnknownSync(Schema.NullOr(CartPublicState))(
    await resolved.json()
  );
};

describe("commercetools commerce HTTP API", () => {
  it.each([
    {
      purchasingMode: "b2c",
      headers: personal,
      otherHeaders: company,
      owner: "personal",
    },
    {
      purchasingMode: "b2b",
      headers: company,
      otherHeaders: personal,
      owner: "company-1",
    },
  ] as const)(
    "lists the $purchasingMode address book without constructing a Cart",
    async ({ purchasingMode, headers, otherHeaders, owner }) => {
      const f = fixture(false, undefined, undefined, purchasingMode);
      try {
        const personalResponse = await f.send(
          "/address-book",
          "GET",
          undefined,
          headers
        );
        const body: unknown = await personalResponse.json();
        expect({
          status: personalResponse.status,
          body,
          cache: personalResponse.headers.get("cache-control"),
        }).toEqual({ status: 200, body: [], cache: "private, no-store" });
        await expect(
          statusOf(f.send("/address-book", "GET", undefined, otherHeaders))
        ).resolves.toBe(403);
        expect({
          reads: f.addressReads,
          cartContexts: f.contexts,
          cookie: f.cookie(),
        }).toEqual({
          reads: [owner],
          cartContexts: [],
          cookie: undefined,
        });
      } finally {
        await f.transport.dispose();
      }
    }
  );

  const deniedAddressRequests: readonly {
    headers: Record<string, string>;
    status: number;
  }[] = [
    { headers: {}, status: 401 },
    { headers: { authorization: "Bearer invalid" }, status: 401 },
    { headers: { authorization: "Bearer valid" }, status: 403 },
    {
      headers: {
        ...company,
        "x-context-business-unit-id": "unassigned-company",
      },
      status: 403,
    },
  ];

  it.each(deniedAddressRequests)(
    "rejects inaccessible address requests with $status before reading addresses",
    async ({ headers, status }) => {
      const f = fixture(false, undefined, undefined, "b2b");
      try {
        await expect(
          statusOf(f.send("/address-book", "GET", undefined, headers))
        ).resolves.toBe(status);
        expect(f.addressReads).toEqual([]);
      } finally {
        await f.transport.dispose();
      }
    }
  );

  it.each([
    {
      failure: new AddressBookAccessDenied({
        message: "Private provider denial",
        operation: "list",
      }),
      status: 403,
    },
    {
      failure: new AddressBookProviderFailure({
        message: "Private transport details",
        operation: "list",
        reason: "unavailable",
      }),
      status: 503,
    },
  ])(
    "projects address read failures to a safe $status response",
    async ({ failure, status }) => {
      const f = fixture(false, undefined, failure);
      try {
        const response = await f.send(
          "/address-book",
          "GET",
          undefined,
          personal
        );
        expect(response.status).toBe(status);
        const body = await response.text();
        expect(body).not.toContain("Private");
      } finally {
        await f.transport.dispose();
      }
    }
  );

  it("exposes authenticated Order reads independently of cart credentials", async () => {
    const f = fixture();
    try {
      const response = await f.send(
        "/orders?allStores=true&purchaseOrderNumber=PO-42&limit=2",
        "GET",
        undefined,
        personal
      );
      expect(response.status).toBe(200);
      expect(f.orderReads[0]).toMatchObject({
        input: {
          filters: { purchaseOrderNumber: "PO-42" },
          limit: 2,
          stores: { _tag: "AllStores" },
        },
        principal: "B2CPurchasingPrincipal",
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(f.cookie()).toBeUndefined();
      await expect(statusOf(f.send("/orders?allStores=true"))).resolves.toBe(
        401
      );
    } finally {
      await f.transport.dispose();
    }
  });

  it("passes an explicitly selected company and Store to Order reads and uses safe missing-detail responses", async () => {
    const f = fixture(false, undefined, undefined, "b2b");
    try {
      await expect(
        statusOf(f.send("/orders?storeKey=historic", "GET", undefined, company))
      ).resolves.toBe(200);
      expect(f.orderReads[0]).toMatchObject({
        companyPermission: true,
        input: { stores: { _tag: "SingleStore", storeKey: "historic" } },
        principal: "CustomerCommercePrincipal",
      });
      await expect(
        statusOf(
          f.send(
            "/orders/opaque%2Fid?allStores=true",
            "GET",
            undefined,
            company
          )
        )
      ).resolves.toBe(404);
      await expect(
        statusOf(f.send("/orders", "GET", undefined, company))
      ).resolves.toBe(400);
    } finally {
      await f.transport.dispose();
    }
  });

  it.each(["allStores=true", "storeKey=historic"])(
    "reads company history in a different presentation Store with %s",
    async (selection) => {
      const f = fixture(false, undefined, undefined, "b2b");
      try {
        const response = await f.send(
          `/orders?${selection}`,
          "GET",
          undefined,
          {
            ...company,
            "x-context-locale": "fr-FR",
          }
        );
        expect(response.status).toBe(200);
        expect(f.orderReads[0]).toMatchObject({
          companyPermission: true,
          input: { locale: "fr-FR" },
          principal: "CustomerCommercePrincipal",
        });
        expect(f.contexts).toHaveLength(0);
        await expect(
          statusOf(
            f.send(`/orders?${selection}`, "GET", undefined, {
              ...company,
              "x-context-business-unit-id": "not-a-member",
            })
          )
        ).resolves.toBe(403);
        expect(f.orderReads).toHaveLength(1);
      } finally {
        await f.transport.dispose();
      }
    }
  );

  const buyingContexts: readonly [string, Record<string, string>][] = [
    ["guest", {}],
    ["B2C", personal],
    ["B2B", company],
  ];

  it.each(buyingContexts)(
    "supports the full cart lifecycle for %s",
    async (_label, headers) => {
      const f = fixture();
      try {
        const added = await f.send("/cart/items", "POST", item, headers);
        expect(added.status).toBe(200);
        const publicState = Schema.decodeUnknownSync(CartPublicState)(
          await added.json()
        );
        expect(publicState.cart.lineItems[0]?.variant.id).toBe(item.variantId);
        expect(JSON.stringify(publicState)).not.toContain("customer-1");
        const [lineItem] = publicState.cart.lineItems;
        if (!lineItem) {
          throw new Error("Expected the added line item");
        }
        const lineItemId = lineItem.id;
        const updated = await readCart(
          f.send("/cart/items", "PATCH", { lineItemId, quantity: 3 }, headers)
        );
        expect(updated?.cart.totalLineItemQuantity).toBe(3);
        const removed = await readCart(
          f.send("/cart/items", "DELETE", { lineItemId }, headers)
        );
        expect(removed?.cart.totalLineItemQuantity).toBe(0);
      } finally {
        await f.transport.dispose();
      }
    }
  );

  it.each(buyingContexts)(
    "mutates discount codes through the current %s buyer context",
    async (_label, headers) => {
      const f = fixture();
      try {
        await f.send("/cart/items", "POST", item, headers);
        const added = await readCart(
          f.send(
            "/cart/discount-codes",
            "PATCH",
            { action: "add", code: "DEAL" },
            headers
          )
        );
        expect(added?.cart.discountCodes).toEqual([
          { applicable: false, code: "DEAL" },
        ]);
        const removed = await readCart(
          f.send(
            "/cart/discount-codes",
            "PATCH",
            { action: "remove", code: "DEAL" },
            headers
          )
        );
        expect(removed?.cart.discountCodes).toEqual([]);
      } finally {
        await f.transport.dispose();
      }
    }
  );

  it("mounts the cart lifecycle at the configured prefix only", async () => {
    const f = fixture(false, "/api/commerce");
    try {
      const added = await readCart(
        f.send("/cart/items", "POST", item, personal)
      );
      const lineItemId = added?.cart.lineItems[0]?.id;
      if (!lineItemId) {
        throw new Error("Expected the added line item");
      }
      await expect(
        readCart(
          f.send("/cart/items", "PATCH", { lineItemId, quantity: 3 }, personal)
        )
      ).resolves.toMatchObject({ cart: { totalLineItemQuantity: 3 } });
      await expect(
        statusOf(f.send("/products?limit=20", "GET", undefined, personal))
      ).resolves.toBe(200);
      await expect(
        readCart(f.send("/cart/items", "DELETE", { lineItemId }, personal))
      ).resolves.toMatchObject({ cart: { totalLineItemQuantity: 0 } });
      await expect(
        statusOf(f.transport.handler(new Request("https://api.example/cart")))
      ).resolves.toBe(404);
    } finally {
      await f.transport.dispose();
    }
  });

  it("isolates selected companies and personal carts", async () => {
    const f = fixture();
    try {
      await f.send("/cart/items", "POST", item, company);
      await expect(
        readCart(
          f.send("/cart", "GET", undefined, {
            ...company,
            "x-context-business-unit-id": "company-2",
          })
        )
      ).resolves.toBeNull();
      await expect(
        readCart(f.send("/cart", "GET", undefined, personal))
      ).resolves.toBeNull();
      expect(f.contexts[0]).toMatchObject({ businessUnitId: "company-1" });
    } finally {
      await f.transport.dispose();
    }
  });

  it("derives the Store from locale and leaves catalog reads free of cart writes", async () => {
    const f = fixture();
    try {
      await expect(
        statusOf(
          f.send("/products?limit=20", "GET", undefined, {
            "x-context-locale": "en-GB",
            "x-context-store-key": "ignored",
          })
        )
      ).resolves.toBe(200);
      expect(f.contexts[0]?.store).toMatchObject({
        currency: "GBP",
        locale: "en-GB",
        storeKey: "de-fr-uk",
      });
      expect(f.cookie()).toBeUndefined();
    } finally {
      await f.transport.dispose();
    }
  });

  it("rejects invalid credentials and contradictory or missing company context", async () => {
    const f = fixture();
    try {
      const statuses = await Promise.all(
        ["Bearer invalid", "Basic valid"].map(
          async (authorization) =>
            await statusOf(
              f.send("/cart/items", "POST", item, { authorization })
            )
        )
      );
      expect(statuses).toEqual([401, 401]);
      await expect(
        statusOf(
          f.send("/cart", "GET", undefined, {
            ...personal,
            "x-context-business-unit-id": "company-1",
          })
        )
      ).resolves.toBe(403);
      await expect(
        statusOf(
          f.send("/cart", "GET", undefined, { authorization: "Bearer valid" })
        )
      ).resolves.toBe(403);
      expect(f.contexts).toEqual([]);
    } finally {
      await f.transport.dispose();
    }
  });

  it("rejects malformed input before cart writes", async () => {
    const f = fixture();
    try {
      await expect(
        statusOf(f.send("/cart/items", "POST", { ...item, quantity: 0 }))
      ).resolves.toBe(400);
      await expect(statusOf(f.send("/products?limit=1000"))).resolves.toBe(400);
      for (const locale of ["invalid", "fr-CH"]) {
        await expect(
          statusOf(
            f.send("/cart", "GET", undefined, { "x-context-locale": locale })
          )
        ).resolves.toBe(400);
      }
      expect(f.cookie()).toBeUndefined();
    } finally {
      await f.transport.dispose();
    }
  });

  it("preserves an uncertain write and the new guest cart credential", async () => {
    const f = fixture(true);
    try {
      const response = await f.send("/cart/items", "POST", item);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        _tag: "CartWriteOutcomeUnknown",
      });
      expect(f.cookie()).toContain(ANONYMOUS_CART_COOKIE_NAME);
    } finally {
      await f.transport.dispose();
    }
  });
});
