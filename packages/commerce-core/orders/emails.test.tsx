import { expect, it } from "@effect/vitest";
import { EmailProvider } from "@repo/email";
import type { EmailMessage } from "@repo/email";
import { Effect, Layer, Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderNotice } from "../domain/order-lifecycle";
import { OrderEmails } from "../services/order-processing";
import { orderEmailsLayer } from "./emails";

it.effect(
  "renders recorded purchase data and forwards stable delivery keys",
  () => {
    const outbox: EmailMessage[] = [];
    const notice = Schema.decodeSync(Schema.toCodecJson(OrderNotice))({
      detailUrl:
        "https://shop.example.test/en-US/orders/order/access?token=opaque",
      fulfillments: [
        {
          deliveryStatus: "unknown",
          id: "delivery",
          lineItems: [],
          status: "fulfilled",
          tracking: [{ carrier: "Carrier", number: "TRACK" }],
        },
      ],
      id: "order",
      lineItems: [{ id: "line", name: "Recorded item", orderedQuantity: 2 }],
      locale: "en-US",
      number: "R-1001",
      purchasingMode: "b2c",
      recipient: "buyer@example.test",
      total: { amount: "12.345", currencyCode: "BHD" },
    });
    return Effect.gen(function* () {
      const emails = yield* OrderEmails;
      yield* emails.send("created", notice, "created-key");
      yield* emails.send("shipped", notice, "shipped-key");
      yield* emails.send(
        "created",
        { ...notice, recipient: undefined },
        "skip-key"
      );
      const shipped = renderToStaticMarkup(outbox[1]?.react);
      expect({
        confirmationContainsTracking: renderToStaticMarkup(
          outbox[0]?.react
        ).includes("TRACK"),
        containsOrderLink: shipped.includes(
          "/orders/order/access?token=opaque"
        ),
        containsOriginalAmount: shipped.includes("12.345"),
        containsRecordedItem: shipped.includes("Recorded item"),
        containsTracking: shipped.includes("TRACK"),
        key: outbox[1]?.idempotencyKey,
        messages: outbox.length,
      }).toEqual({
        confirmationContainsTracking: false,
        containsOrderLink: true,
        containsOriginalAmount: true,
        containsRecordedItem: true,
        containsTracking: true,
        key: "shipped-key",
        messages: 2,
      });
    }).pipe(
      Effect.provide(
        orderEmailsLayer.pipe(
          Layer.provide(
            Layer.succeed(EmailProvider, {
              send: (message) =>
                Effect.sync(() => {
                  outbox.push(message);
                  return { providerMessageId: "sent" };
                }),
            })
          )
        )
      )
    );
  }
);
