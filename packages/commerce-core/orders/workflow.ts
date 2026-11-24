/* oxlint-disable no-await-in-loop -- Each iteration waits for durable steps or hooks. */
import type { Hook } from "workflow";
import { createHook, FatalError } from "workflow";

import type { OrderLifecycleState } from "../domain/order-lifecycle";
import {
  orderPaymentToken,
  orderWorkflowToken,
} from "../domain/order-lifecycle";
import type { PreparedOrderEmail } from "./workflow-steps";

interface OrderSteps {
  readonly readOrder: (id: string) => Promise<OrderLifecycleState>;
  readonly settleImmediatePayment: (id: string) => Promise<OrderLifecycleState>;
  readonly prepareEmail: (id: string) => Promise<PreparedOrderEmail | null>;
  readonly sendConfirmation: (email: PreparedOrderEmail) => Promise<void>;
  readonly sendShipmentNotice: (email: PreparedOrderEmail) => Promise<void>;
  readonly closeOrder: (id: string) => Promise<OrderLifecycleState>;
}

export interface OrderWorkflowResult {
  readonly orderId: string;
  readonly stage: "cancelled" | "completed" | "ignored";
}

const terminalState = (
  order: OrderLifecycleState
): OrderWorkflowResult["stage"] | undefined => {
  if (!order.managed) {
    return "ignored";
  }
  if (order.cancelled) {
    return "cancelled";
  }
  if (order.closed && (!order.fullyShipped || !order.paymentSettled)) {
    return "completed";
  }
};

async function tryOrderEmail(
  orderId: string,
  prepare: OrderSteps["prepareEmail"],
  send: OrderSteps["sendConfirmation"]
): Promise<void> {
  try {
    const email = await prepare(orderId);
    if (email) {
      await send(email);
    }
  } catch {
    // Workflow records the failed step. Order processing can continue without the notice.
  }
}

export async function runOrderWorkflow(
  orderId: string,
  steps: OrderSteps
): Promise<OrderWorkflowResult> {
  let order = await steps.readOrder(orderId);
  let stage = terminalState(order);
  if (stage) {
    return { orderId, stage };
  }

  await tryOrderEmail(orderId, steps.prepareEmail, steps.sendConfirmation);

  let fulfillmentUpdates: Hook<null> | undefined;
  let paymentUpdates: Hook<null> | undefined;
  let shipmentNoticeAttempted = false;

  while (!stage) {
    const waitingForPayment =
      !order.paymentSettled &&
      (!order.deferredPayment ||
        (order.fullyShipped && shipmentNoticeAttempted));
    if (waitingForPayment) {
      if (paymentUpdates) {
        await paymentUpdates;
      } else {
        paymentUpdates = createHook<null>({
          token: orderPaymentToken(orderId),
        });
        if (await paymentUpdates.getConflict()) {
          throw new FatalError("Order payment hook belongs to another run");
        }
        // Read after registering the hook to catch payment recorded earlier.
      }
      order = order.deferredPayment
        ? await steps.readOrder(orderId)
        : await steps.settleImmediatePayment(orderId);
    } else if (!order.fullyShipped) {
      // The start hook buffers updates from the moment the run is admitted.
      fulfillmentUpdates ??= createHook<null>({
        token: orderWorkflowToken(orderId),
      });
      await fulfillmentUpdates;
      order = await steps.readOrder(orderId);
    } else if (shipmentNoticeAttempted) {
      order = await steps.closeOrder(orderId);
      if (order.closed && !order.cancelled && order.managed) {
        return { orderId, stage: "completed" };
      }
    } else {
      await tryOrderEmail(
        orderId,
        steps.prepareEmail,
        steps.sendShipmentNotice
      );
      shipmentNoticeAttempted = true;
    }
    stage = terminalState(order);
  }

  return { orderId, stage };
}
