import { runOrderWorkflow } from "@repo/commerce-core/orders/workflow";

import {
  closeOrder,
  prepareEmail,
  readOrder,
  sendConfirmation,
  sendShipmentNotice,
  settleImmediatePayment,
} from "./workflow-steps";

export async function orderCreatedWorkflow(orderId: string) {
  "use workflow";
  return await runOrderWorkflow(orderId, {
    closeOrder,
    prepareEmail,
    readOrder,
    sendConfirmation,
    sendShipmentNotice,
    settleImmediatePayment,
  });
}
