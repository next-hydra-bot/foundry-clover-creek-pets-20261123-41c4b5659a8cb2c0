import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import type {
  CartDraft,
  ByProjectKeyRequestBuilder,
} from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/ts-client";
import { describe, expect, it } from "@effect/vitest";
import {
  CartId,
  LineItemId,
  PositiveCartQuantity,
  VariantId,
} from "@repo/commerce-core/domain/cart";
import { CountryCode } from "@repo/commerce-core/domain/checkout";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import { AnonymousCommercePrincipal } from "@repo/commerce-core/domain/commerce-request-context";
import {
  DeliveryGroupReference,
  DeliveryPlanQuoteReference,
  DeliveryPlanReference,
  ShippingOptionReference,
} from "@repo/commerce-core/domain/delivery-plan";
import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { Carts } from "@repo/commerce-core/services/carts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import { CommerceLocale, Store, StoreKey } from "@repo/commerce-core/store";
import type { Client } from "@urql/core";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { vi } from "vitest";

import { CommercetoolsGraphQLClient } from "../client/graphql-client";
import { CommercetoolsRestClient } from "../client/rest-client";
import {
  deliveryAddressKeyFor,
  shippingKeyFor,
} from "../delivery-planning/references";
import { variantReference } from "../product/variant-reference";
import { cartsLayer, checkoutCartsLayer } from "./carts";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

type ScriptedResponse = {
  readonly data?: unknown;
  readonly error?: unknown;
};

type GraphqlDocument = {
  readonly definitions?: readonly {
    readonly name?: { readonly value?: string };
  }[];
};

type GraphqlVariables = Parameters<Client["query"]>[1];

type RecordedCall = {
  readonly operation: string;
  readonly variables: GraphqlVariables;
};

const operationName = (document: GraphqlDocument): string =>
  document.definitions?.[0]?.name?.value ?? "unknown";

const makeScriptedClients = (
  apiRoot?: ByProjectKeyRequestBuilder,
  selectedLayer = cartsLayer
) => {
  const queues = new Map<string, ScriptedResponse[]>();
  const sticky = new Map<string, ScriptedResponse>();
  const calls: RecordedCall[] = [];

  // The urql query/mutation contract returns a thenable; this double resolves each scripted
  // response synchronously but must hand back a Promise so persistence can await it.
  // oxlint-disable-next-line typescript/promise-function-async
  const respond = (
    document: GraphqlDocument,
    variables: GraphqlVariables
  ): Promise<ScriptedResponse> => {
    const operation = operationName(document);
    calls.push({ operation, variables });
    const next = queues.get(operation)?.shift();
    if (next !== undefined) {
      sticky.set(operation, next);
      return Promise.resolve(next);
    }
    const last = sticky.get(operation);
    if (last === undefined) {
      throw new Error(`No scripted response for operation ${operation}`);
    }
    return Promise.resolve(last);
  };

  const on = (operation: string, ...responses: readonly ScriptedResponse[]) => {
    queues.set(operation, [...(queues.get(operation) ?? []), ...responses]);
  };

  const callsFor = (operation: string) =>
    calls.filter((call) => call.operation === operation);

  // SAFETY: Cart persistence only awaits query/mutation and reads `data`/`error`; the scripted
  // Promise models the entire consumed contract, and the associate REST root stays unused here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const graphqlClient = {
    mutation: respond,
    query: respond,
  } as unknown as Pick<Client, "mutation" | "query">;
  // SAFETY: These cases exercise only the GraphQL client; the associate REST root is never called.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const unusedApiRoot = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fake implements only the SDK calls consumed by this test.
  } as ByProjectKeyRequestBuilder;

  const layer = selectedLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        CommercetoolsGraphQLClient.testLayer(graphqlClient),
        CommercetoolsRestClient.testLayer(apiRoot ?? unusedApiRoot)
      )
    )
  );

  return { callsFor, layer, on };
};

const store = new Store({
  currency: "USD",
  locale: CommerceLocale.make("en-US"),
  storeKey: StoreKey.make("us-store"),
});

const anonymousTarget = {
  _tag: "AnonymousCartTarget" as const,
  id: CartId.make("cart-1"),
  store,
};

const currentVersion = 7;
const providerVersion = 8;
const unitPriceCentAmount = 2500;

const rawActiveCart = {
  taxMode: "Disabled",
  billingAddress: null,
  businessUnit: null,
  cartState: "Active",
  country: null,
  custom: null,
  customerEmail: null,
  id: "cart-1",
  lineItems: [],
  shippingAddress: null,
  shippingMode: "Multiple",
  store: { key: "us-store" },
  totalLineItemQuantity: 0,
  totalPrice: { centAmount: 0, currencyCode: "USD" },
  version: currentVersion,
};

const rawPaymentBillingAddress = {
  additionalStreetInfo: null,
  city: "New York",
  country: "US",
  key: null,
  postalCode: "10001",
  region: null,
  state: "NY",
  streetName: "1 Payment Way",
};

const rawPreparedCardPayment = {
  amountPlanned: { centAmount: 2500, currencyCode: "USD" },
  custom: {
    customFieldsRaw: [
      {
        name: "checkoutPlacementAttemptReference",
        value: "attempt-1",
      },
    ],
    type: { key: "paymentCustomFields" },
  },
  id: "payment-1",
  interfaceId: "pi-1",
  key: "checkout-card-cart-1",
  paymentMethodInfo: {
    method: "card",
    paymentInterface: "Stripe",
    token: { value: "confirmation-1" },
  },
};

const rawCartLineItem = {
  id: "line-1",
  key: null,
  name: "Hydra Crane",
  price: {
    discounted: null,
    value: { centAmount: unitPriceCentAmount, currencyCode: "USD" },
  },
  productId: "product-1",
  productType: {
    attributeDefinitions: {
      results: [
        {
          labelAllLocales: [{ locale: "en-US", value: "Model" }],
          name: "model",
        },
      ],
    },
    key: "heavy-earthmoving-and-construction-equipment",
  },
  quantity: 1,
  totalPrice: { centAmount: unitPriceCentAmount, currencyCode: "USD" },
  variant: {
    attributesRaw: [
      {
        name: "model",
        value: 2015,
      },
    ],
    id: 3,
    images: [{ label: "Crane", url: "https://example.com/crane.jpg" }],
    sku: "SKU-3",
  },
};

const rawCartWithLineItem = {
  ...rawActiveCart,
  lineItems: [rawCartLineItem],
  totalLineItemQuantity: 1,
  totalPrice: { centAmount: unitPriceCentAmount, currencyCode: "USD" },
};

const selectedDeliveryPlan = {
  groups: [
    {
      reference: DeliveryGroupReference.make("delivery-1"),
      selectedShippingOption: {
        name: "Standard",
        price: { centAmount: 500, currencyCode: "USD" as const },
        reference: ShippingOptionReference.make(
          "shipping-option-c2hpcHBpbmctbWV0aG9kLTE"
        ),
      },
      shippingAddress: {
        addressLine1: "1 Hydra Way",
        city: "New York",
        country: CountryCode.make("US"),
        postalCode: "10001",
      },
      targets: [{ lineItemId: LineItemId.make("line-1"), quantity: 1 }],
    },
  ],
  quoteReference: DeliveryPlanQuoteReference.make("quote-1"),
  reference: DeliveryPlanReference.make("plan-1"),
} as const;

const rawBusinessUnitCart = {
  ...rawActiveCart,
  businessUnit: { id: "business-unit-1" },
};

const cartByIdData = <Cart>(cart: Cart) => ({ data: { cart } });
const distributionChannelData = {
  data: {
    store: { distributionChannels: [{ key: "distribution-channel-1" }] },
  },
};
const updateCartData = <Cart>(cart: Cart) => ({ data: { updateCart: cart } });
const forbidden = {
  error: {
    graphQLErrors: [{ extensions: { code: "Forbidden" } }],
    message: "Associate is not authorized",
  },
};
const concurrentModification = (currentProviderVersion: number) => ({
  error: {
    graphQLErrors: [
      {
        extensions: {
          code: "ConcurrentModification",
          currentVersion: currentProviderVersion,
        },
      },
    ],
  },
});

const associateScopeInput = {
  businessUnitId: CommerceBusinessUnitId.make("business-unit-1"),
  businessUnitKey: CommerceBusinessUnitKey.make("business-unit-key-1"),
  customerId: CommerceCustomerId.make("customer-1"),
  store,
} as const;

describe("findById", () => {
  it.effect(
    "projects an owned provider Cart without leaking its version",
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData(rawActiveCart));

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });
        const cart = Option.getOrThrow(found);

        expect(cart).not.toHaveProperty("version");
        expect(cart).toMatchObject({
          id: "cart-1",
          status: "active",
          storeKey: "us-store",
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect("projects provider line-item variant identity", () => {
    const clients = makeScriptedClients();
    clients.on("CartById", cartByIdData(rawCartWithLineItem));

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const found = yield* carts.findById({ id: CartId.make("cart-1"), store });
      const cart = Option.getOrThrow(found);

      expect(cart.lineItems[0]?.variant).toMatchObject({
        id: variantReference("product-1", 3),
        productId: "product-1",
        sku: "SKU-3",
        summaryAttribute: { label: "Model", value: "2015" },
      });
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect(
    "uses configured locale priority for the Cart summary label",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawCartWithLineItem,
          lineItems: [
            {
              ...rawCartLineItem,
              productType: {
                ...rawCartLineItem.productType,
                attributeDefinitions: {
                  results: [
                    {
                      labelAllLocales: [
                        { locale: "de-DE", value: "Modell" },
                        { locale: "fr-FR", value: "Modèle" },
                      ],
                      name: "model",
                    },
                  ],
                },
              },
            },
          ],
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });

        expect(Option.getOrThrow(found).lineItems[0]?.variant).toMatchObject({
          summaryAttribute: { label: "Modèle", value: "2015" },
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect("omits a Cart summary attribute without a usable label", () => {
    const clients = makeScriptedClients();
    clients.on(
      "CartById",
      cartByIdData({
        ...rawCartWithLineItem,
        lineItems: [
          {
            ...rawCartLineItem,
            productType: {
              ...rawCartLineItem.productType,
              attributeDefinitions: {
                results: [
                  {
                    labelAllLocales: [
                      { locale: "de-DE", value: "" },
                      { locale: "en-US", value: "   " },
                    ],
                    name: "model",
                  },
                ],
              },
            },
          },
        ],
      })
    );

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const found = yield* carts.findById({ id: CartId.make("cart-1"), store });
      const variant = Option.getOrThrow(found).lineItems[0]?.variant;

      expect(variant).not.toHaveProperty("summaryAttribute");
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect(
    "projects outdoor size and color choices into a cart line summary",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawCartWithLineItem,
          lineItems: [
            {
              ...rawCartLineItem,
              productType: {
                attributeDefinitions: { results: [] },
                key: "outdoor-product",
              },
              variant: {
                ...rawCartLineItem.variant,
                attributesRaw: [
                  { name: "material", value: "Nylon" },
                  { name: "weightGrams", value: 380 },
                  { name: "size", value: { key: "M", label: "M" } },
                  { name: "color", value: { key: "BLUE", label: "Blue" } },
                ],
              },
            },
          ],
        })
      );
      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });
        expect(
          Option.getOrThrow(found).lineItems[0]?.variant.summaryAttribute
        ).toEqual({ label: "Size / Color", value: "M / Blue" });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect("omits Product Attributes not selected for Cart display", () => {
    const clients = makeScriptedClients();
    clients.on(
      "CartById",
      cartByIdData({
        ...rawCartWithLineItem,
        lineItems: [
          {
            ...rawCartLineItem,
            productType: {
              attributeDefinitions: { results: [] },
              key: "heavy-lifting-and-specialized-equipment",
            },
            variant: {
              ...rawCartLineItem.variant,
              attributesRaw: [
                {
                  name: "color",
                  value: {
                    key: "RED",
                    label: { "de-DE": "Rot" },
                  },
                },
              ],
            },
          },
        ],
      })
    );

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const found = yield* carts.findById({ id: CartId.make("cart-1"), store });
      const variant = Option.getOrThrow(found).lineItems[0]?.variant;

      expect(variant).toMatchObject({ id: variantReference("product-1", 3) });
      expect(variant).not.toHaveProperty("summaryAttribute");
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect("distinguishes confirmed absence from provider failure", () => {
    const clients = makeScriptedClients();
    clients.on("CartById", cartByIdData(null));

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const found = yield* carts.findById({
        id: CartId.make("missing"),
        store,
      });
      expect(Option.isNone(found)).toBeTruthy();
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect("reports invalid provider projections as invalid data", () => {
    const clients = makeScriptedClients();
    clients.on(
      "CartById",
      cartByIdData({ ...rawActiveCart, totalLineItemQuantity: -1 })
    );

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const error = yield* carts
        .findById({ id: CartId.make("cart-1"), store })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "CartProviderFailure",
        reason: "invalidData",
      });
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect(
    "projects a prepared Payment from the linked Payment object",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          billingAddress: rawPaymentBillingAddress,
          paymentInfo: {
            paymentRefs: [{ id: "payment-1" }],
            payments: [rawPreparedCardPayment],
          },
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });

        expect(
          Option.getOrThrow(found).checkoutDetails.preparedPayment
        ).toEqual({
          amount: { centAmount: 2500, currencyCode: "USD" },
          attemptReference: "attempt-1",
          billingAddress: {
            addressLine1: "1 Payment Way",
            city: "New York",
            country: "US",
            postalCode: "10001",
            region: "NY",
          },
          method: "card",
          paymentReference: "payment-1",
          preparationReference: "checkout-card-cart-1:USD:2500",
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "projects a selected Card Payment without reading its masked token",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          billingAddress: rawPaymentBillingAddress,
          paymentInfo: {
            paymentRefs: [{ id: "payment-1" }],
            payments: [
              {
                ...rawPreparedCardPayment,
                custom: {
                  customFieldsRaw: [
                    {
                      name: "checkoutPlacementAttemptReference",
                      value: "attempt-1",
                    },
                  ],
                  type: { key: "paymentCustomFields" },
                },
                paymentMethodInfo: {
                  method: "card",
                  paymentInterface: "Stripe",
                },
              },
            ],
          },
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });

        expect(
          Option.getOrThrow(found).checkoutDetails.preparedPayment
        ).toMatchObject({
          method: "card",
          paymentReference: "payment-1",
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "projects Net Terms assertions from the linked Payment object",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          billingAddress: rawPaymentBillingAddress,
          paymentInfo: {
            paymentRefs: [{ id: "net-terms-payment-1" }],
            payments: [
              {
                amountPlanned: { centAmount: 2500, currencyCode: "USD" },
                custom: {
                  customFieldsRaw: [
                    {
                      name: "checkoutPlacementAttemptReference",
                      value: "attempt-1",
                    },
                    { name: "checkoutTermsInDays", value: 30 },
                  ],
                  type: { key: "paymentCustomFields" },
                },
                id: "net-terms-payment-1",
                interfaceId: "checkout-net-terms-cart-1",
                key: "checkout-net-terms-cart-1",
                paymentMethodInfo: {
                  method: "netTerms",
                  paymentInterface: "erp-credit",
                },
              },
            ],
          },
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });

        expect(
          Option.getOrThrow(found).checkoutDetails.preparedPayment
        ).toEqual({
          amount: { centAmount: 2500, currencyCode: "USD" },
          attemptReference: "attempt-1",
          billingAddress: {
            addressLine1: "1 Payment Way",
            city: "New York",
            country: "US",
            postalCode: "10001",
            region: "NY",
          },
          method: "netTerms",
          paymentReference: "net-terms-payment-1",
          termsInDays: 30,
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "rejects linked Payment metadata stored under another Custom Type",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          billingAddress: rawPaymentBillingAddress,
          paymentInfo: {
            paymentRefs: [{ id: "payment-1" }],
            payments: [
              {
                ...rawPreparedCardPayment,
                custom: {
                  ...rawPreparedCardPayment.custom,
                  type: { key: "anotherPaymentType" },
                },
              },
            ],
          },
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const result = yield* carts
          .findById({
            id: CartId.make("cart-1"),
            store,
          })
          .pipe(Effect.result);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "CartProviderFailure",
            operation: "findById",
            reason: "invalidData",
          },
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "keeps shopping carts readable when expanded Payments are not linked",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          billingAddress: rawPaymentBillingAddress,
          paymentInfo: {
            paymentRefs: [{ id: "another-payment" }],
            payments: [rawPreparedCardPayment],
          },
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });

        expect(found).toMatchObject({ _tag: "Some", value: { id: "cart-1" } });
        if (Option.isSome(found)) {
          expect(found.value.checkoutDetails.preparedPayment).toBeUndefined();
        }
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "keeps provider-managed Payments readable without a custom prepared Payment",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          paymentInfo: { paymentRefs: [{ id: "orphaned-payment" }] },
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });

        expect(found).toMatchObject({ _tag: "Some", value: { id: "cart-1" } });
        if (Option.isSome(found)) {
          expect(found.value.checkoutDetails.preparedPayment).toBeUndefined();
        }
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "reports malformed persisted Checkout custom JSON as invalid provider data",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          custom: {
            customFieldsRaw: [
              { name: "checkoutDeliveryDetails", value: "{not-json" },
            ],
            type: { key: "orderCustomFields" },
          },
        })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const result = yield* carts
          .findById({ id: CartId.make("cart-1"), store })
          .pipe(Effect.result);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "CartProviderFailure",
            operation: "findById",
            reason: "invalidData",
          },
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect("ignores native Shipping that no longer matches the Cart", () => {
    const clients = makeScriptedClients();
    const groupReference = DeliveryGroupReference.make("delivery-1");
    const quoteReference = DeliveryPlanQuoteReference.make("quote-1");
    const planReference = DeliveryPlanReference.make("plan-1");
    const shippingKey = shippingKeyFor(
      groupReference,
      quoteReference,
      planReference
    );
    const addressKey = deliveryAddressKeyFor(groupReference);
    const address = {
      additionalStreetInfo: null,
      city: "New York",
      country: "US",
      key: addressKey,
      postalCode: "10001",
      region: null,
      state: "NY",
      streetName: "1 Hydra Way",
    };
    clients.on(
      "CartById",
      cartByIdData({
        ...rawCartWithLineItem,
        itemShippingAddresses: [address],
        lineItems: [
          {
            ...rawCartLineItem,
            shippingDetails: {
              targets: [
                {
                  addressKey,
                  quantity: 1,
                  shippingMethodKey: shippingKey,
                },
              ],
              valid: true,
            },
          },
        ],
        shipping: [
          {
            shippingAddress: address,
            shippingInfo: {
              price: { centAmount: 500, currencyCode: "USD" },
              shippingMethodName: "Standard",
              shippingMethodRef: { id: "standard" },
              shippingMethodState: "DoesNotMatchCart",
            },
            shippingKey,
          },
        ],
        shippingMode: "Multiple",
      })
    );

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const found = yield* carts.findById({
        id: CartId.make("cart-1"),
        store,
      });

      expect(Option.getOrThrow(found).checkoutDetails).not.toHaveProperty(
        "selectedDeliveryPlan"
      );
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect(
    "rejects Business Unit Carts presented as anonymous possession",
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData(rawBusinessUnitCart));

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const error = yield* carts
          .findById({ id: CartId.make("cart-1"), store })
          .pipe(Effect.flip);

        expect(error._tag).toBe("CartAccessDenied");
      }).pipe(Effect.provide(clients.layer));
    }
  );
});

describe("saveShippingOptions", () => {
  it.effect("maps merchandise repricing to an unavailable selection", () => {
    // SAFETY: This test exercises the anonymous Cart update chain consumed by
    // saveShippingOptions and returns the SDK response shape it awaits.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
    const apiRoot = {
      carts: () => ({
        withId: () => ({
          post: () => ({
            execute: async () =>
              await Promise.reject(
                Object.assign(new Error("No matching merchandise price"), {
                  body: { errors: [{ code: "MatchingPriceNotFound" }] },
                  statusCode: 400,
                })
              ),
          }),
        }),
      }),
    } as unknown as ByProjectKeyRequestBuilder;
    const clients = makeScriptedClients(apiRoot);
    clients.on(
      "CartById",
      cartByIdData({
        ...rawCartWithLineItem,
        itemShippingAddresses: [],
        shipping: [],
        shippingMode: "Multiple",
      })
    );

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const error = yield* carts
        .saveShippingOptions({
          selectedDeliveryPlan,
          target: anonymousTarget,
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CartShippingSelectionUnavailable");
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect(
    "requires refresh when the confirmed write cannot be reloaded",
    () => {
      // SAFETY: This test exercises only the anonymous Cart update chain consumed
      // by saveShippingOptions and returns the SDK response shape it awaits.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
      const apiRoot = {
        carts: () => ({
          withId: () => ({
            post: () => ({
              execute: async () =>
                await Promise.resolve({ body: { id: "cart-1" } }),
            }),
          }),
        }),
      } as unknown as ByProjectKeyRequestBuilder;
      const clients = makeScriptedClients(apiRoot);
      clients.on(
        "CartById",
        cartByIdData({
          ...rawCartWithLineItem,
          itemShippingAddresses: [],
          shipping: [],
          shippingMode: "Multiple",
        }),
        {
          error: {
            message: "Reload unavailable",
            networkError: new Error("Reload unavailable"),
          },
        }
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const error = yield* carts
          .saveShippingOptions({
            selectedDeliveryPlan,
            target: anonymousTarget,
          })
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "CartShippingOptionsRefreshRequired",
          cartId: "cart-1",
          operation: "saveShippingOptions",
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );
});

describe("addItem", () => {
  it.effect("rejects unresolved references before calling the provider", () => {
    const clients = makeScriptedClients();
    return Effect.gen(function* () {
      const carts = yield* Carts;
      const variantId = VariantId.make("3");
      const error = yield* carts
        .addItem({
          quantity: 1,
          target: anonymousTarget,
          variantId,
        })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "CartMerchandiseUnavailable",
        variantId,
      });
      expect(clients.callsFor("CartById")).toEqual([]);
      expect(clients.callsFor("AddItemToCart")).toEqual([]);
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect(
    "resolves the Store distribution channel before writing the line item",
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData(rawActiveCart));
      clients.on("ProviderCartDistributionChannel", distributionChannelData);
      clients.on(
        "AddItemToCart",
        updateCartData({ ...rawCartWithLineItem, version: providerVersion })
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const updated = yield* carts.addItem({
          quantity: 1,
          target: anonymousTarget,
          variantId: variantReference("product-1", 3),
        });

        expect(updated).toMatchObject({ id: "cart-1" });
        expect(clients.callsFor("AddItemToCart")[0]?.variables).toMatchObject({
          distributionChannelKey: "distribution-channel-1",
          productId: "product-1",
          variantId: 3,
        });
        expect(updated.lineItems[0]?.variant.id).toBe(
          variantReference("product-1", 3)
        );
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "rejects ambiguous Store distribution channels before adding merchandise",
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData(rawActiveCart));
      clients.on("ProviderCartDistributionChannel", {
        data: {
          store: {
            distributionChannels: [{ key: "company-a" }, { key: "company-b" }],
          },
        },
      });
      return Effect.gen(function* () {
        const carts = yield* Carts;
        const outcome = yield* carts
          .addItem({
            quantity: 1,
            target: anonymousTarget,
            variantId: variantReference("product-1", 3),
          })
          .pipe(Effect.exit);
        expect(outcome._tag).toBe("Failure");
        expect(clients.callsFor("AddItemToCart")).toEqual([]);
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect("maps provider-confirmed unavailable merchandise", () => {
    const clients = makeScriptedClients();
    clients.on("CartById", cartByIdData(rawActiveCart));
    clients.on("ProviderCartDistributionChannel", distributionChannelData);
    clients.on("AddItemToCart", {
      error: {
        graphQLErrors: [{ extensions: { code: "MatchingPriceNotFound" } }],
        message: "No matching price",
      },
    });

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const error = yield* carts
        .addItem({
          quantity: 1,
          target: anonymousTarget,
          variantId: variantReference("product-1", 3),
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CartMerchandiseUnavailable");
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect("preserves an ambiguous add-line-item result as unknown", () => {
    const clients = makeScriptedClients();
    clients.on("CartById", cartByIdData(rawActiveCart));
    clients.on("ProviderCartDistributionChannel", distributionChannelData);
    clients.on("AddItemToCart", {
      error: {
        message: "Connection closed after dispatch",
        networkError: new Error("Connection closed after dispatch"),
      },
    });

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const error = yield* carts
        .addItem({
          quantity: 1,
          target: anonymousTarget,
          variantId: variantReference("product-1", 3),
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CartWriteOutcomeUnknown");
    }).pipe(Effect.provide(clients.layer));
  });
});

describe("findActiveForBusinessUnit", () => {
  it.effect("projects provider Carts into domain Carts", () => {
    const clients = makeScriptedClients();
    clients.on("GetActiveCartForBusinessUnitAsAssociate", {
      data: { asAssociate: { carts: { results: [rawBusinessUnitCart] } } },
    });

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const result =
        yield* carts.findActiveForBusinessUnit(associateScopeInput);

      expect(result[0]).toMatchObject({
        buyingContext: { businessUnitId: "business-unit-1" },
        id: "cart-1",
      });
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect(
    "preserves provider authorization failures as access denied",
    () => {
      const clients = makeScriptedClients();
      clients.on("GetActiveCartForBusinessUnitAsAssociate", forbidden);

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const error = yield* carts
          .findActiveForBusinessUnit(associateScopeInput)
          .pipe(Effect.flip);

        expect(error._tag).toBe("CartAccessDenied");
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect("treats an unclassified provider read failure as a defect", () => {
    const clients = makeScriptedClients();
    clients.on("GetActiveCartForBusinessUnitAsAssociate", {
      error: {
        graphQLErrors: [
          { extensions: { code: "InternalProviderContractViolation" } },
        ],
        message: "Unexpected provider response",
      },
    });

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const exit = yield* carts
        .findActiveForBusinessUnit(associateScopeInput)
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBeTruthy();
      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
        "Unexpected provider response"
      );
    }).pipe(Effect.provide(clients.layer));
  });
});

describe("setLineItemQuantity", () => {
  it.effect("rejects a missing line before changing its quantity", () => {
    const clients = makeScriptedClients();
    clients.on("CartById", cartByIdData(rawActiveCart));

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const error = yield* carts
        .setLineItemQuantity({
          lineItemId: LineItemId.make("line-1"),
          quantity: 2,
          target: anonymousTarget,
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CartLineItemNotFound");
    }).pipe(Effect.provide(clients.layer));
  });

  it.effect("preserves an unknown quantity-write outcome", () => {
    const clients = makeScriptedClients();
    clients.on("CartById", cartByIdData(rawCartWithLineItem));
    clients.on("ChangeItemQuantity", {
      error: {
        message: "Connection closed after dispatch",
        networkError: new Error("Connection closed after dispatch"),
      },
    });

    return Effect.gen(function* () {
      const carts = yield* Carts;
      const error = yield* carts
        .setLineItemQuantity({
          lineItemId: LineItemId.make("line-1"),
          quantity: 2,
          target: anonymousTarget,
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CartWriteOutcomeUnknown");
    }).pipe(Effect.provide(clients.layer));
  });
});

describe("versioned write conflict policy", () => {
  it.effect(
    "retries a narrow Delivery action with the provider version",
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData(rawActiveCart));
      clients.on(
        "SaveCheckoutDeliveryDetails",
        concurrentModification(providerVersion),
        updateCartData(rawActiveCart)
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        yield* carts.saveDeliveryDetails({
          deliveryDetails: {
            shippingAddress: {
              addressLine1: "123 Analytical Engine Way",
              city: "London",
              country: CountryCode.make("GB"),
              postalCode: "SW1A 1AA",
            },
            source: "manual",
          },
          target: anonymousTarget,
        });

        const writes = clients.callsFor("SaveCheckoutDeliveryDetails");
        expect(writes).toHaveLength(2);
        expect(writes[1]?.variables).toMatchObject({
          version: providerVersion,
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "does not retry a setCustomType Contact write and surfaces the conflict",
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData(rawActiveCart));
      clients.on(
        "SaveCheckoutContact",
        concurrentModification(providerVersion),
        concurrentModification(providerVersion)
      );

      return Effect.gen(function* () {
        const carts = yield* Carts;
        const error = yield* carts
          .saveContact({
            contact: {
              buyerContact: {
                email: "ada@example.com",
                firstName: "Ada",
                lastName: "Lovelace",
              },
              source: "manual",
            },
            target: anonymousTarget,
          })
          .pipe(Effect.flip);

        expect(error._tag).toBe("CartWriteConflict");
      }).pipe(Effect.provide(clients.layer));
    }
  );
});

describe("personal Cart authority", () => {
  const customerId = CommerceCustomerId.make("personal-customer");
  it.effect(
    "finds personal carts scoped to Customer and Store without a Business Unit",
    () => {
      const clients = makeScriptedClients();
      clients.on("GetActiveCartsForCustomer", {
        data: { carts: { results: [{ ...rawActiveCart, customerId }] } },
      });
      return Effect.gen(function* () {
        const carts = yield* Carts;
        expect(
          yield* carts.findActiveForCustomer({ customerId, store })
        ).toMatchObject([{ customerId, id: "cart-1" }]);
        expect(
          clients.callsFor("GetActiveCartsForCustomer")[0]?.variables
        ).toMatchObject({
          where:
            'cartState="Active" and store(key="us-store") and customerId="personal-customer" and businessUnit is not defined',
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );
  for (const wrongCart of [
    { ...rawActiveCart, customerId: "other-customer" },
    { ...rawActiveCart, businessUnit: { id: "company-1" }, customerId },
    { ...rawActiveCart, customerId, store: { key: "other-store" } },
  ]) {
    it.effect(
      `rejects a personal mutation against ${JSON.stringify(wrongCart.customerId === customerId ? (wrongCart.businessUnit ?? wrongCart.store) : wrongCart.customerId)}`,
      () => {
        const clients = makeScriptedClients();
        clients.on("CartById", cartByIdData(wrongCart));
        return Effect.gen(function* () {
          const carts = yield* Carts;
          const failure = yield* Effect.flip(
            carts.removeLineItem({
              lineItemId: LineItemId.make("line-1"),
              target: {
                _tag: "CustomerCartTarget",
                customerId,
                id: CartId.make("cart-1"),
                store,
              },
            })
          );
          expect(failure._tag).toBe("CartAccessDenied");
        }).pipe(Effect.provide(clients.layer));
      }
    );
  }
  it.effect(
    "does not let an anonymous cart cookie claim a personal cart",
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData({ ...rawActiveCart, customerId }));
      return Effect.gen(function* () {
        const carts = yield* Carts;
        expect(
          yield* Effect.flip(
            carts.findById({ id: CartId.make("cart-1"), store })
          )
        ).toMatchObject({ _tag: "CartAccessDenied" });
      }).pipe(Effect.provide(clients.layer));
    }
  );
});

it.effect(
  "creates a personal Cart with Customer and Store ownership and no company",
  () => {
    let submitted: CartDraft | undefined;
    // SAFETY: This contract double implements the only REST operation consumed by createForCustomer; reads use the scripted GraphQL client.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
    const apiRoot = {
      carts: () => ({
        post: ({ body }: { readonly body: CartDraft }) => {
          submitted = body;
          return {
            // oxlint-disable-next-line require-await -- This SDK test double returns an asynchronous fixture without external I/O.
            execute: async () => ({ body: { id: "personal-created" } }),
          };
        },
      }),
    } as unknown as ByProjectKeyRequestBuilder;
    const clients = makeScriptedClients(apiRoot);
    clients.on(
      "CartById",
      cartByIdData({
        ...rawActiveCart,
        customerId: "personal-customer",
        id: "personal-created",
      })
    );
    return Effect.gen(function* () {
      const carts = yield* Carts;
      const result = yield* carts.createForCustomer({
        customerId: CommerceCustomerId.make("personal-customer"),
        store,
      });
      expect(result).toMatchObject({
        customerId: "personal-customer",
        id: "personal-created",
      });
      expect(submitted).toStrictEqual({
        currency: "USD",
        customerId: "personal-customer",
        shippingMode: "Multiple",
        store: { key: "us-store", typeId: "store" },
      });
    }).pipe(Effect.provide(clients.layer));
  }
);

for (const shippingMode of ["Single", "Multiple"] as const) {
  it.effect(
    `reads ${shippingMode} shipping carts without exposing provider shipping mode`,
    () => {
      const clients = makeScriptedClients();
      clients.on("CartById", cartByIdData({ ...rawActiveCart, shippingMode }));
      return Effect.gen(function* () {
        const carts = yield* Carts;
        const cart = yield* carts.findById({
          id: CartId.make("cart-1"),
          store,
        });
        expect(cart).toMatchObject({ _tag: "Some", value: { id: "cart-1" } });
        if (Option.isSome(cart)) {
          expect(cart.value).not.toHaveProperty("shippingMode");
        }
      }).pipe(Effect.provide(clients.layer));
    }
  );
}

for (const [shippingMode, selectedLayer] of [
  ["Single", checkoutCartsLayer],
  ["Multiple", cartsLayer],
] as const) {
  it.effect(
    `the checkout recipe creates ${shippingMode} shipping carts internally`,
    () => {
      const clients = makeScriptedClients(undefined, selectedLayer);
      clients.on("CreateCart", {
        data: { createCart: { ...rawActiveCart, shippingMode } },
      });
      return Effect.gen(function* () {
        const carts = yield* Carts;
        yield* carts.createAnonymous({ store });
        expect(clients.callsFor("CreateCart")[0]?.variables).toMatchObject({
          shippingMode,
        });
      }).pipe(Effect.provide(clients.layer));
    }
  );
}

const unusedContext = () => Effect.die(new Error("Unexpected context call"));

describe("completed guest cart lifecycle", () => {
  it.effect(
    "clears an ordered guest cart and creates a fresh Single cart on the next Add to Cart",
    () => {
      const clients = makeScriptedClients(undefined, checkoutCartsLayer);
      const freshCart = {
        ...rawActiveCart,
        id: "new-cart",
        shippingMode: "Single",
      };
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          cartState: "Ordered",
          shippingMode: "Single",
        }),
        cartByIdData(freshCart)
      );
      clients.on("CreateCart", { data: { createCart: freshCart } });
      clients.on("ProviderCartDistributionChannel", distributionChannelData);
      clients.on(
        "AddItemToCart",
        updateCartData({
          ...rawCartWithLineItem,
          id: "new-cart",
          shippingMode: "Single",
        })
      );
      const cookies: string[] = [];
      const layer = CurrentCart.layer({
        clear: () =>
          Effect.sync(() => {
            cookies.push("clear");
          }),
        set: (id) =>
          Effect.sync(() => {
            cookies.push(id);
          }),
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            clients.layer,
            CartPolicies.layerEmpty,
            Layer.succeed(
              CommerceContext,
              CommerceContext.of({
                customerPrincipal: unusedContext,
                customerProfile: unusedContext,
                principal: new AnonymousCommercePrincipal({
                  anonymousCartId: CartId.make("cart-1"),
                }),
                store,
              })
            )
          )
        )
      );
      return Effect.gen(function* () {
        const result = yield* CurrentCart.addItem({
          quantity: 1,
          variantId: variantReference("product-1", 3),
        });
        expect(result.cart.id).toBe("new-cart");
        expect(cookies).toEqual(["clear", "new-cart"]);
        expect(clients.callsFor("CreateCart")[0]?.variables).toMatchObject({
          shippingMode: "Single",
        });
        expect(clients.callsFor("AddItemToCart")[0]?.variables).toMatchObject({
          id: "new-cart",
        });
      }).pipe(Effect.provide(layer));
    }
  );

  for (const foreign of [
    { ...rawActiveCart, cartState: "Ordered", customerId: "customer" },
    { ...rawActiveCart, cartState: "Ordered", store: { key: "other-store" } },
    { ...rawBusinessUnitCart, cartState: "Ordered" },
  ]) {
    it.effect(
      "still rejects an ordered cart owned by another buyer or store",
      () => {
        const clients = makeScriptedClients();
        clients.on("CartById", cartByIdData(foreign));
        return Effect.gen(function* () {
          const carts = yield* Carts;
          expect(
            yield* carts
              .findById({ id: CartId.make("cart-1"), store })
              .pipe(Effect.flip)
          ).toHaveProperty("_tag", "CartAccessDenied");
        }).pipe(Effect.provide(clients.layer));
      }
    );
  }
});

it.effect(
  "accepts native Customer Group prices for company carts while using the Store distribution channel",
  () =>
    Effect.gen(function* () {
      for (const [unit, group] of [
        ["business-unit-1", "gold"],
        ["business-unit-2", "silver"],
      ] as const) {
        const requests: { distributionChannel?: { key: string } }[] = [];
        const fetcher: typeof fetch = async (_url, init) => {
          const body = Schema.decodeSync(
            Schema.fromJsonString(
              Schema.Struct({
                actions: Schema.Array(
                  Schema.Struct({
                    distributionChannel: Schema.optional(
                      Schema.Struct({ key: Schema.String })
                    ),
                  })
                ),
              })
            )
          )(Schema.decodeUnknownSync(Schema.String)(init?.body));
          requests.push(...body.actions);
          return await Promise.resolve(
            Response.json({ id: "cart-1", version: 2 })
          );
        };
        const native = new ClientBuilder()
          .withProjectKey("test")
          .withHttpMiddleware({
            enableRetry: false,
            host: "https://ct.example",
            httpClient: fetcher,
          })
          .build();
        const source = makeScriptedClients(
          createApiBuilderFromCtpClient(native).withProjectKey({
            projectKey: "test",
          })
        );
        const empty = {
          ...rawActiveCart,
          businessUnit: { id: unit },
          customerId: "customer-1",
        };
        const filled = {
          ...empty,
          lineItems: [
            {
              ...rawCartLineItem,
              distributionChannel: { id: "store-sales" },
              price: { ...rawCartLineItem.price, customerGroup: { id: group } },
            },
          ],
          totalLineItemQuantity: 1,
        };
        source.on("CartById", cartByIdData(empty), cartByIdData(filled));
        source.on("ProviderCartDistributionChannel", {
          data: {
            store: {
              distributionChannels: [{ key: "store-sales" }],
            },
          },
        });
        const result = yield* Carts.pipe(
          Effect.flatMap((carts) =>
            carts.addItem({
              quantity: PositiveCartQuantity.make(1),
              target: {
                _tag: "BusinessUnitCartTarget",
                businessUnitId: CommerceBusinessUnitId.make(unit),
                businessUnitKey: CommerceBusinessUnitKey.make(unit),
                customerId: CommerceCustomerId.make("customer-1"),
                id: CartId.make("cart-1"),
                store: new Store({
                  currency: "USD",
                  locale: CommerceLocale.make("en-US"),
                  storeKey: StoreKey.make("us-store"),
                }),
              },
              variantId: variantReference("product-1", 3),
            })
          ),
          Effect.result,
          Effect.provide(source.layer)
        );
        expect(result).toMatchObject({ _tag: "Success" });
        expect(
          requests.some(
            (action) => action.distributionChannel?.key === "store-sales"
          )
        ).toBeTruthy();
      }
    })
);

const amount = (centAmount: number) => ({ centAmount, currencyCode: "USD" });

describe("Native Cart tax amounts", () => {
  it.each([false, true])(
    "projects the gross payable total with includedInPrice=%s",
    async (includedInPrice) => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          lineItems: [
            {
              ...rawCartLineItem,
              price: {
                discounted: null,
                value: amount(includedInPrice ? 12_000 : 10_000),
              },
              perMethodTaxRate: [{ taxRate: { includedInPrice } }],
              taxRate: null,
              totalPrice: amount(includedInPrice ? 12_000 : 10_000),
            },
          ],
          taxMode: "Platform",
          taxedPrice: {
            totalGross: amount(12_000),
            totalNet: amount(10_000),
            totalTax: amount(2000),
          },
          totalLineItemQuantity: 1,
          totalPrice: amount(includedInPrice ? 12_000 : 10_000),
        })
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const carts = yield* Carts;
          const result = Option.getOrThrow(
            yield* carts.findById({ id: anonymousTarget.id, store })
          );
          expect(result.totalPrice).toEqual(amount(12_000));
          expect(result.subtotalPrice).toEqual(
            amount(includedInPrice ? 12_000 : 10_000)
          );
          expect(result.tax).toEqual({
            status: "known",
            amount: amount(2000),
            includedInPrice: includedInPrice ? "yes" : "no",
          });
        }).pipe(Effect.provide(clients.layer))
      );
    }
  );

  it.effect(
    "keeps unresolved platform tax unknown and the total estimated",
    () => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          taxMode: "Platform",
          taxedPrice: null,
        })
      );
      return Effect.gen(function* () {
        const carts = yield* Carts;
        const result = Option.getOrThrow(
          yield* carts.findById({ id: anonymousTarget.id, store })
        );
        expect(result.tax).toEqual({ status: "unknown" });
        expect(result.totalPriceEstimated).toBeTruthy();
      }).pipe(Effect.provide(clients.layer));
    }
  );
});

describe("Deleted discount code recovery", () => {
  const deletedCode = {
    discountCode: null,
    discountCodeRef: { id: "deleted-code" },
    state: "NotActive",
  };
  const inactiveCode = {
    discountCode: { code: "EXPIRED" },
    discountCodeRef: { id: "inactive-code" },
    state: "NotValid",
  };
  const makeRecoveryClients = (status = 200) => {
    const writes: unknown[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      writes.push(
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(init?.body)
      );
      return await Promise.resolve(
        Response.json(
          status === 200
            ? { id: "cart-1", version: providerVersion }
            : {
                errors: [
                  {
                    code: "ConcurrentModification",
                    currentVersion: providerVersion,
                  },
                ],
              },
          { status }
        )
      );
    };
    const native = new ClientBuilder()
      .withProjectKey("test")
      .withHttpMiddleware({
        enableRetry: false,
        host: "https://ct.example",
        httpClient: fetcher,
      })
      .build();
    return {
      clients: makeScriptedClients(
        createApiBuilderFromCtpClient(native).withProjectKey({
          projectKey: "test",
        })
      ),
      writes,
    };
  };

  describe.each(["anonymous", "personal", "company"] as const)(
    "%s purchasing",
    (kind) => {
      it.effect(
        "reconciles deleted references while retaining existing ineligible codes",
        () => {
          const { clients, writes } = makeRecoveryClients();
          const original = {
            ...rawActiveCart,
            businessUnit:
              kind === "company"
                ? { id: associateScopeInput.businessUnitId }
                : null,
            customerId:
              kind === "anonymous" ? null : associateScopeInput.customerId,
            discountCodes: [deletedCode, inactiveCode],
            paymentInfo: {
              paymentRefs: [{ id: "payment-1" }],
              payments: [rawPreparedCardPayment],
            },
          };
          const refreshed = {
            ...original,
            discountCodes: [inactiveCode],
            paymentInfo: null,
            version: providerVersion,
          };
          if (kind === "anonymous") {
            clients.on(
              "CartById",
              cartByIdData(original),
              cartByIdData(refreshed)
            );
          } else {
            clients.on(
              kind === "personal"
                ? "GetActiveCartsForCustomer"
                : "GetActiveCartForBusinessUnitAsAssociate",
              {
                data:
                  kind === "personal"
                    ? { carts: { results: [original] } }
                    : { asAssociate: { carts: { results: [original] } } },
              }
            );
            clients.on("CartById", cartByIdData(refreshed));
          }
          return Effect.gen(function* () {
            const carts = yield* Carts;
            const result =
              kind === "anonymous"
                ? Option.getOrThrow(
                    yield* carts.findById({ id: anonymousTarget.id, store })
                  )
                : (yield* kind === "personal"
                    ? carts.findActiveForCustomer({
                        customerId: associateScopeInput.customerId,
                        store,
                      })
                    : carts.findActiveForBusinessUnit(associateScopeInput))[0];
            expect(result?.discountCodes).toEqual([
              { applicable: false, code: "EXPIRED" },
            ]);
            expect(result?.checkoutDetails.preparedPayment).toBeUndefined();
            expect(writes).toEqual([
              {
                actions: [
                  {
                    action: "removePayment",
                    payment: { id: "payment-1", typeId: "payment" },
                  },
                  { action: "setBillingAddress" },
                  {
                    action: "removeDiscountCode",
                    discountCode: {
                      id: "deleted-code",
                      typeId: "discount-code",
                    },
                  },
                ],
                version: currentVersion,
              },
            ]);
          }).pipe(Effect.provide(clients.layer));
        }
      );
    }
  );

  it.effect(
    "uses the reconciled version when applying the requested code",
    () => {
      const { clients, writes } = makeRecoveryClients();
      const original = { ...rawActiveCart, discountCodes: [deletedCode] };
      const refreshed = { ...rawActiveCart, version: providerVersion };
      const updated = {
        ...refreshed,
        discountCodes: [
          {
            discountCode: { code: "DEAL" },
            discountCodeRef: { id: "deal-code" },
            state: "MatchesCart",
          },
        ],
        version: providerVersion + 1,
      };
      clients.on(
        "CartById",
        cartByIdData(original),
        cartByIdData(refreshed),
        cartByIdData(updated)
      );
      return Effect.gen(function* () {
        const carts = yield* Carts;
        const result = yield* carts.changeDiscountCode({
          action: "add",
          code: "DEAL",
          target: anonymousTarget,
        });
        expect(result.discountCodes).toEqual([
          { applicable: true, code: "DEAL" },
        ]);
        expect(writes).toEqual([
          {
            actions: [
              {
                action: "removeDiscountCode",
                discountCode: { id: "deleted-code", typeId: "discount-code" },
              },
            ],
            version: currentVersion,
          },
          {
            actions: [{ action: "addDiscountCode", code: "DEAL" }],
            version: providerVersion,
          },
        ]);
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "requires a fresh read after a cleanup conflict without replaying the write",
    () => {
      const { clients, writes } = makeRecoveryClients(409);
      clients.on(
        "CartById",
        cartByIdData({ ...rawActiveCart, discountCodes: [deletedCode] })
      );
      return Effect.gen(function* () {
        const carts = yield* Carts;
        const error = yield* carts
          .findById({ id: anonymousTarget.id, store })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "CartProviderFailure",
          reason: "unavailable",
        });
        expect(writes).toHaveLength(1);
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect(
    "accepts cleanup completed by another request after a version conflict",
    () => {
      const { clients, writes } = makeRecoveryClients(409);
      clients.on(
        "CartById",
        cartByIdData({ ...rawActiveCart, discountCodes: [deletedCode] }),
        cartByIdData({ ...rawActiveCart, version: providerVersion })
      );
      return Effect.gen(function* () {
        const carts = yield* Carts;
        const found = Option.getOrThrow(
          yield* carts.findById({ id: anonymousTarget.id, store })
        );
        expect(found.discountCodes).toEqual([]);
        expect(writes).toHaveLength(1);
      }).pipe(Effect.provide(clients.layer));
    }
  );

  it.effect("does not reconcile another customer's cart", () => {
    const { clients, writes } = makeRecoveryClients();
    clients.on(
      "CartById",
      cartByIdData({
        ...rawActiveCart,
        customerId: "other-customer",
        discountCodes: [deletedCode],
      })
    );
    return Effect.gen(function* () {
      const carts = yield* Carts;
      const error = yield* carts
        .findById({ id: anonymousTarget.id, store })
        .pipe(Effect.flip);
      expect(error._tag).toBe("CartAccessDenied");
      expect(writes).toHaveLength(0);
    }).pipe(Effect.provide(clients.layer));
  });
});

describe("Native discount combinations", () => {
  it.each([
    {
      chosenDiscountType: "CartDiscount",
      allocation: 3000,
      subtotal: 10_000,
      total: 7000,
      unit: 10_000,
    },
    {
      chosenDiscountType: "ProductDiscount",
      allocation: 0,
      subtotal: 8000,
      total: 8000,
      unit: 8000,
    },
    {
      chosenDiscountType: undefined,
      allocation: 1000,
      subtotal: 8000,
      total: 7000,
      unit: 8000,
    },
  ])(
    "projects native discount combination $chosenDiscountType",
    async ({ chosenDiscountType, allocation, subtotal, total, unit }) => {
      const clients = makeScriptedClients();
      clients.on(
        "CartById",
        cartByIdData({
          ...rawActiveCart,
          discountTypeCombination:
            chosenDiscountType === undefined
              ? { __typename: "Stacking" }
              : { __typename: "BestDeal", chosenDiscountType },
          lineItems: [
            {
              ...rawCartLineItem,
              price: {
                value: amount(10_000),
                discounted: { value: amount(8000) },
              },
              discountedPricePerQuantity:
                allocation === 0
                  ? []
                  : [
                      {
                        quantity: 1,
                        discountedPrice: {
                          includedDiscounts: [
                            {
                              discountRef: { id: "offer" },
                              discount: { name: "Offer" },
                              discountedAmount: amount(allocation),
                            },
                          ],
                        },
                      },
                    ],
              totalPrice: amount(total),
            },
          ],
          totalLineItemQuantity: 1,
          totalPrice: amount(total),
        })
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const carts = yield* Carts;
          const result = Option.getOrThrow(
            yield* carts.findById({ id: CartId.make("cart-1"), store })
          );
          expect(result.totalPrice.centAmount).toBe(total);
          expect(result.subtotalPrice?.centAmount).toBe(subtotal);
          expect(result.lineItems[0]?.unitPrice.centAmount).toBe(unit);
          expect(result.lineItems[0]?.regularUnitPrice?.centAmount).toBe(
            chosenDiscountType === "CartDiscount" ? undefined : 10_000
          );
        }).pipe(Effect.provide(clients.layer))
      );
    }
  );
});

it.effect(
  "projects per-quantity, total and shipping allocations without recalculating the provider total",
  () => {
    const portion = (id: string, centAmount: number) => ({
      discount: { name: id },
      discountRef: { id },
      discountedAmount: amount(centAmount),
    });
    const clients = makeScriptedClients();
    clients.on(
      "CartById",
      cartByIdData({
        ...rawActiveCart,
        discountCodes: [
          {
            discountCode: { code: "DEAL" },
            discountCodeRef: { id: "code-1" },
            state: "MatchesCart",
          },
        ],
        discountOnTotalPrice: {
          includedDiscounts: [portion("cart-offer", 150)],
        },
        lineItems: [
          {
            ...rawCartLineItem,
            discountedPricePerQuantity: [
              {
                quantity: 2,
                discountedPrice: {
                  includedDiscounts: [portion("line-offer", 250)],
                },
              },
              { quantity: 1, discountedPrice: { includedDiscounts: [] } },
            ],
            quantity: 3,
            totalPrice: amount(7000),
          },
        ],
        shippingInfo: {
          discountedPrice: {
            includedDiscounts: [portion("free-shipping", 300)],
          },
        },
        shippingMode: "Single",
        totalLineItemQuantity: 3,
        totalPrice: amount(6850),
      })
    );
    return Effect.gen(function* () {
      const carts = yield* Carts;
      const result = Option.getOrThrow(
        yield* carts.findById({ id: CartId.make("cart-1"), store })
      );
      expect(result.subtotalPrice?.centAmount).toBe(7500);
      expect(result.totalPrice.centAmount).toBe(6850);
      expect(result.lineItems[0]?.totalPrice?.centAmount).toBe(7000);
      expect(result.discountCodes).toEqual([
        { applicable: true, code: "DEAL" },
      ]);
      expect(result.discounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            amount: amount(500),
            reference: "line-offer",
            target: "items",
          }),
          expect.objectContaining({
            amount: amount(150),
            reference: "cart-offer",
            target: "total",
          }),
          expect.objectContaining({
            amount: amount(300),
            reference: "free-shipping",
            target: "shipping",
          }),
        ])
      );
    }).pipe(Effect.provide(clients.layer));
  }
);

it.effect(
  "applies and removes native discount codes with the current cart version",
  () => {
    const bodies: unknown[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      bodies.push(
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(init?.body)
      );
      return await Promise.resolve(
        Response.json({ id: "cart-1", version: providerVersion })
      );
    };
    const native = new ClientBuilder()
      .withProjectKey("test")
      .withHttpMiddleware({
        enableRetry: false,
        host: "https://ct.example",
        httpClient: fetcher,
      })
      .build();
    const clients = makeScriptedClients(
      createApiBuilderFromCtpClient(native).withProjectKey({
        projectKey: "test",
      })
    );
    const discounted = {
      ...rawActiveCart,
      discountCodes: [
        {
          discountCode: { code: "DEAL" },
          discountCodeRef: { id: "native-code-1" },
          state: "MatchesCart",
        },
      ],
      version: providerVersion,
    };
    clients.on(
      "CartById",
      cartByIdData(rawActiveCart),
      cartByIdData(discounted),
      cartByIdData(discounted),
      cartByIdData(rawActiveCart)
    );
    return Effect.gen(function* () {
      const carts = yield* Carts;
      yield* carts.changeDiscountCode({
        action: "add",
        code: "DEAL",
        target: anonymousTarget,
      });
      yield* carts.changeDiscountCode({
        action: "remove",
        code: "DEAL",
        target: anonymousTarget,
      });
      expect(bodies).toEqual([
        {
          actions: [{ action: "addDiscountCode", code: "DEAL" }],
          version: currentVersion,
        },
        {
          actions: [
            {
              action: "removeDiscountCode",
              discountCode: { id: "native-code-1", typeId: "discount-code" },
            },
          ],
          version: providerVersion,
        },
      ]);
    }).pipe(Effect.provide(clients.layer));
  }
);
