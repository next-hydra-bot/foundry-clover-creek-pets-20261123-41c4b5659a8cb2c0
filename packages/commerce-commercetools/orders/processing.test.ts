import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import type { Order, Payment, Transaction } from "@commercetools/platform-sdk";
import { expect, it } from "@effect/vitest";
import { OrderId } from "@repo/commerce-core/domain/order-identity";
import { OrderProcessing } from "@repo/commerce-core/services/order-processing";
import { Effect, Redacted, Schema } from "effect";

import { cardPaymentKeyForCheckout } from "../payment-repository/keys";
import { orderProcessingLayerFrom } from "./processing";

const id = OrderId.make("order-1");
const cartId = "checkout-cart";
const order = (overrides: Partial<Order> = {}) => ({
  createdAt: "2026-11-01T10:00:00Z",
  customLineItems: [
    {
      id: "service",
      name: { "en-US": "Recorded service" },
      quantity: 1,
      totalPrice: {
        centAmount: 12_345,
        currencyCode: "BHD",
        fractionDigits: 3,
        type: "centPrecision",
      },
    },
  ],
  customerEmail: "buyer@example.test",
  id,
  lineItems: [],
  locale: "en-US",
  orderNumber: "R-1001",
  orderState: "Confirmed",
  paymentState: "Paid",
  shipmentState: "Shipped",
  store: { key: "default-store" },
  totalPrice: {
    centAmount: 12_345,
    currencyCode: "BHD",
    fractionDigits: 3,
    type: "centPrecision",
  },
  version: 7,
  ...overrides,
});
const Update = Schema.Struct({
  actions: Schema.Array(
    Schema.Union([
      Schema.Struct({
        action: Schema.Literal("changePaymentState"),
        paymentState: Schema.Literal("Paid"),
      }),
      Schema.Struct({
        action: Schema.Literal("changeOrderState"),
        orderState: Schema.Literal("Complete"),
      }),
    ])
  ),
  version: Schema.Int,
});
const fixture = (initial: ReturnType<typeof order>) => {
  const native = { ...initial };
  let conflict = false;
  const writes: (typeof Update.Type)[] = [];
  const api = createApiBuilderFromCtpClient({
    execute: async (request: {
      readonly method: string;
      readonly body?: unknown;
    }) => {
      if (request.method === "POST") {
        const update = Schema.decodeUnknownSync(Update)(request.body);
        if (conflict || update.version !== native.version) {
          throw Object.assign(new Error("Order changed"), { statusCode: 409 });
        }
        writes.push(update);
        for (const action of update.actions) {
          switch (action.action) {
            case "changePaymentState": {
              Object.assign(native, { paymentState: action.paymentState });
              break;
            }
            case "changeOrderState": {
              Object.assign(native, { orderState: action.orderState });
              break;
            }
            default: {
              throw new Error("Unexpected Order update action");
            }
          }
        }
        native.version += 1;
      }
      return await Promise.resolve({ body: native, statusCode: 200 });
    },
  }).withProjectKey({ projectKey: "project" });
  return {
    conflict: () => {
      conflict = true;
    },
    edit: (changes: Partial<Order>) => {
      Object.assign(native, changes, { version: native.version + 1 });
    },
    layer: orderProcessingLayerFrom(api),
    writes,
  };
};

const amount = {
  centAmount: 12_345,
  currencyCode: "BHD",
  fractionDigits: 3,
  type: "centPrecision",
} as const;
const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  amount,
  id: "capture",
  state: "Success",
  type: "Charge",
  ...overrides,
});
const payment = (overrides: Partial<Payment> = {}): Payment => ({
  amountPlanned: amount,
  createdAt: "2026-11-01T10:00:00Z",
  id: "payment-1",
  interfaceInteractions: [],
  key: cardPaymentKeyForCheckout(cartId),
  lastModifiedAt: "2026-11-01T10:00:00Z",
  paymentMethodInfo: { method: "card" },
  paymentStatus: {},
  transactions: [transaction()],
  version: 1,
  ...overrides,
});
const capturedOrder = (value = payment(), overrides: Partial<Order> = {}) =>
  order({
    cart: { id: cartId, typeId: "cart" },
    paymentInfo: {
      payments: [{ id: value.id, obj: value, typeId: "payment" }],
    },
    paymentState: undefined,
    ...overrides,
  });

it.effect(
  "reconciles a captured Card Payment once and completes a shipped Order",
  () => {
    const f = fixture(capturedOrder());
    return Effect.gen(function* () {
      const processing = yield* OrderProcessing;
      expect(
        (yield* processing.reconcilePayment(id)).paymentSettled
      ).toBeTruthy();
      expect(
        (yield* processing.reconcilePayment(id)).paymentSettled
      ).toBeTruthy();
      yield* processing.close(id);
      expect(f.writes).toEqual([
        {
          actions: [{ action: "changePaymentState", paymentState: "Paid" }],
          version: 7,
        },
        {
          actions: [{ action: "changeOrderState", orderState: "Complete" }],
          version: 8,
        },
      ]);
    }).pipe(Effect.provide(f.layer));
  }
);

it.effect(
  "records collected Card funds while fulfillment is still pending",
  () => {
    const f = fixture(capturedOrder(payment(), { shipmentState: "Pending" }));
    return Effect.gen(function* () {
      const processing = yield* OrderProcessing;
      expect(yield* processing.reconcilePayment(id)).toMatchObject({
        fullyShipped: false,
        paymentSettled: true,
      });
      expect((yield* processing.close(id)).closed).toBeFalsy();
      expect(f.writes).toEqual([
        {
          actions: [{ action: "changePaymentState", paymentState: "Paid" }],
          version: 7,
        },
      ]);
    }).pipe(Effect.provide(f.layer));
  }
);

it.effect(
  "rereads the payable amount before closing a previously paid Order",
  () => {
    const original = payment();
    const f = fixture(capturedOrder(original, { paymentState: "Paid" }));
    return Effect.gen(function* () {
      const processing = yield* OrderProcessing;
      expect((yield* processing.read(id)).paymentSettled).toBeTruthy();

      const updatedTotal = { ...amount, centAmount: amount.centAmount + 1000 };
      f.edit({ totalPrice: updatedTotal });
      expect(yield* processing.close(id)).toMatchObject({
        closed: false,
        paymentSettled: false,
      });
      expect(f.writes).toHaveLength(0);

      const topUp = payment({
        amountPlanned: { ...amount, centAmount: 1000 },
        id: "top-up",
        key: "top-up",
        transactions: [
          transaction({ amount: { ...amount, centAmount: 1000 } }),
        ],
      });
      f.edit({
        paymentInfo: {
          payments: [original, topUp].map((value) => ({
            id: value.id,
            obj: value,
            typeId: "payment",
          })),
        },
      });
      expect((yield* processing.close(id)).closed).toBeTruthy();
      expect(f.writes).toEqual([
        {
          actions: [{ action: "changeOrderState", orderState: "Complete" }],
          version: 9,
        },
      ]);
    }).pipe(Effect.provide(f.layer));
  }
);

it.effect(
  "keeps a checkout Order open after a successful refund reduces its paid balance",
  () => {
    const refunded = payment({
      transactions: [
        transaction(),
        transaction({
          amount: { ...amount, centAmount: 1000 },
          id: "refund",
          type: "Refund",
        }),
      ],
    });
    const f = fixture(capturedOrder(refunded, { paymentState: "Paid" }));
    return Effect.gen(function* () {
      const processing = yield* OrderProcessing;
      expect(yield* processing.close(id)).toMatchObject({
        closed: false,
        paymentSettled: false,
      });
      expect(f.writes).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }
);

for (const example of [
  {
    name: "an authorization",
    payment: payment({
      transactions: [transaction({ type: "Authorization" })],
    }),
  },
  {
    name: "a pending capture",
    payment: payment({ transactions: [transaction({ state: "Pending" })] }),
  },
  {
    name: "a failed capture",
    payment: payment({ transactions: [transaction({ state: "Failure" })] }),
  },
  {
    name: "a partial capture",
    payment: payment({
      transactions: [transaction({ amount: { ...amount, centAmount: 6000 } })],
    }),
  },
  {
    name: "a refunded capture",
    payment: payment({
      transactions: [
        transaction(),
        transaction({
          amount: { ...amount, centAmount: 1 },
          id: "refund",
          type: "Refund",
        }),
      ],
    }),
  },
  {
    name: "a Net Terms credit commitment",
    payment: payment({ paymentMethodInfo: { method: "netTerms" } }),
  },
  {
    name: "a different currency",
    payment: payment({
      transactions: [
        transaction({ amount: { ...amount, currencyCode: "USD" } }),
      ],
    }),
  },
]) {
  it.effect(`does not mark ${example.name} as settled funds`, () => {
    const f = fixture(capturedOrder(example.payment));
    return Effect.gen(function* () {
      const processing = yield* OrderProcessing;
      expect(
        (yield* processing.reconcilePayment(id)).paymentSettled
      ).toBeFalsy();
      expect((yield* processing.close(id)).closed).toBeFalsy();
      expect(f.writes).toEqual([]);
    }).pipe(Effect.provide(f.layer));
  });
}

it.effect(
  "retries payment reconciliation when the native Order changes",
  () => {
    const f = fixture(capturedOrder());
    f.conflict();
    return Effect.gen(function* () {
      const error = yield* (yield* OrderProcessing)
        .reconcilePayment(id)
        .pipe(Effect.flip);
      expect(error.reason).toBe("conflict");
      expect(f.writes).toEqual([]);
    }).pipe(Effect.provide(f.layer));
  }
);
it.effect(
  "projects recorded B2B and B2C purchase data and preserves amount precision",
  () => {
    const f = fixture(order());
    return Effect.gen(function* () {
      const processing = yield* OrderProcessing;
      const state = yield* processing.read(id);
      expect(state).toMatchObject({
        fullyShipped: true,
        managed: true,
        paymentSettled: true,
      });
      const notice = yield* processing.notice(id);
      expect(notice.total).toEqual({ amount: "12.345", currencyCode: "BHD" });
      expect(notice.recipient && Redacted.value(notice.recipient)).toBe(
        "buyer@example.test"
      );
      expect(notice.lineItems[0]?.name).toBe("Recorded service");
      yield* processing.close(id);
      expect(f.writes).toEqual([
        {
          actions: [{ action: "changeOrderState", orderState: "Complete" }],
          version: 7,
        },
      ]);
    }).pipe(Effect.provide(f.layer));
  }
);
it.effect("leaves an unpaid B2B order open even after shipment", () => {
  const f = fixture(
    order({
      businessUnit: { key: "company", typeId: "business-unit" },
      paymentState: "Pending",
    })
  );
  return Effect.gen(function* () {
    expect(
      (yield* (yield* OrderProcessing).read(id)).paymentSettled
    ).toBeFalsy();
    expect(yield* (yield* OrderProcessing).close(id)).toMatchObject({
      closed: false,
      paymentSettled: false,
    });
    expect(f.writes).toEqual([]);
  }).pipe(Effect.provide(f.layer));
});
it.effect("does not change a cancelled order", () => {
  const f = fixture(order({ orderState: "Cancelled" }));
  return Effect.gen(function* () {
    expect((yield* (yield* OrderProcessing).close(id)).cancelled).toBeTruthy();
    expect(f.writes).toEqual([]);
  }).pipe(Effect.provide(f.layer));
});

it.effect("reconciles the gross capture on a tax-exclusive order", () => {
  const net = { ...amount, centAmount: 10_000 };
  const f = fixture(
    capturedOrder(payment(), {
      taxedPrice: { taxPortions: [], totalGross: amount, totalNet: net },
      totalPrice: net,
    })
  );
  return Effect.gen(function* () {
    const processing = yield* OrderProcessing;
    expect(
      (yield* processing.reconcilePayment(id)).paymentSettled
    ).toBeTruthy();
    expect((yield* processing.close(id)).closed).toBeTruthy();
  }).pipe(Effect.provide(f.layer));
});
