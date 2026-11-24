import { EmailProvider } from "@repo/email";
import { OrderNotificationTemplate } from "@repo/email/templates/order-notification";
import { Effect, Layer, Redacted } from "effect";

import { OrderLifecycleFailure } from "../domain/order-lifecycle";
import { OrderEmails } from "../services/order-processing";
import { formatOrderMoney } from "./presentation";

export const orderEmailsLayer = Layer.effect(
  OrderEmails,
  Effect.gen(function* () {
    const email = yield* EmailProvider;
    return OrderEmails.of({
      send: Effect.fn("OrderEmails.send")(
        function* (kind, notice, idempotencyKey) {
          if (!notice.recipient) {
            yield* Effect.logInfo(
              "Order notification skipped: no recorded recipient",
              { kind, orderId: notice.id }
            );
            return "skipped" as const;
          }
          const title =
            kind === "created"
              ? "Order confirmation"
              : "Your order has shipped";
          yield* email
            .send({
              idempotencyKey,
              react: (
                <OrderNotificationTemplate
                  title={title}
                  introduction={
                    kind === "created"
                      ? "We have received your order."
                      : "Your order has been fulfilled. Shipment tracking is shown below when available."
                  }
                  orderNumber={notice.number ?? notice.id}
                  orderUrl={
                    notice.detailUrl
                      ? Redacted.value(notice.detailUrl)
                      : undefined
                  }
                  orderLinkLabel="View your order"
                  totalLabel="Total"
                  total={formatOrderMoney(notice.total, notice.locale)}
                  lines={notice.lineItems.map((line) => ({
                    amount: line.total
                      ? formatOrderMoney(line.total.money, notice.locale)
                      : undefined,
                    id: line.id,
                    name: line.name,
                    quantity: line.orderedQuantity,
                  }))}
                  tracking={
                    kind === "shipped"
                      ? notice.fulfillments.flatMap((item) => item.tracking)
                      : []
                  }
                />
              ),
              subject: `${title} — ${notice.number ?? notice.id}`,
              to: Redacted.value(notice.recipient),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrderLifecycleFailure({
                    cause,
                    message: "Order email delivery failed",
                    orderId: notice.id,
                    reason: "unavailable",
                  })
              )
            );
          return "sent" as const;
        }
      ),
    });
  })
);
