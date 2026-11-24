import { Clock, Effect } from "effect";
import { getHookByToken, resumeHook, start } from "workflow/api";
import { HookConflictError, HookNotFoundError } from "workflow/errors";

import type {
  OrderLifecycleState,
  OrderWorkflowSignal,
} from "../domain/order-lifecycle";
import {
  orderPaymentToken,
  orderWorkflowAccepts,
  orderWorkflowAdmissionWindow,
  orderWorkflowToken,
} from "../domain/order-lifecycle";
import type { OrderWorkflowResult } from "./workflow";

const resume = async (token: string) => {
  try {
    await resumeHook(token, null);
    return true;
  } catch (error) {
    if (!HookNotFoundError.is(error)) {
      throw error;
    }
    return false;
  }
};

const isAdmitted = async (token: string) => {
  try {
    await getHookByToken(token);
    return true;
  } catch (error) {
    if (!HookNotFoundError.is(error)) {
      throw error;
    }
    return false;
  }
};

export const orderWorkflowDispatcher =
  (
    workflow: (orderId: string) => Promise<OrderWorkflowResult>,
    readOrder: (orderId: string) => Promise<OrderLifecycleState>
  ) =>
  async (orderId: string, signal: "created" | OrderWorkflowSignal) => {
    const startToken = orderWorkflowToken(orderId);
    if (signal !== "created") {
      const resumed = await Promise.all([
        signal === "payment" ? false : resume(startToken),
        signal === "fulfillment" ? false : resume(orderPaymentToken(orderId)),
      ]);
      // An admitted run rereads the Order after opening the payment hook.
      // A retained token also covers updates arriving after the run ends.
      if (resumed.some(Boolean) || (await isAdmitted(startToken))) {
        return;
      }
    }

    const order = await readOrder(orderId);
    const now = await Effect.runPromise(Clock.currentTimeMillis);
    if (!orderWorkflowAccepts(order, now)) {
      return;
    }
    if (signal !== "created") {
      return order.closed || order.cancelled
        ? undefined
        : ("waitingForStart" as const);
    }
    try {
      await start(workflow, [orderId], {
        experimental_hook: {
          experimental_minRetention: orderWorkflowAdmissionWindow,
          token: startToken,
        },
      });
    } catch (error) {
      if (!HookConflictError.is(error)) {
        throw error;
      }
    }
  };
