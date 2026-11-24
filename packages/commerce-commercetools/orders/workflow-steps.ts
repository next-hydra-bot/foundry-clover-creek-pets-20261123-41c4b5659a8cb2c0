import type { PreparedOrderEmail } from "@repo/commerce-core/orders/workflow-steps";

import { orderWorkflowOperations } from "./workflow-operations";

export async function readOrder(id: string) {
  "use step";
  return await orderWorkflowOperations.readOrder(id);
}

export async function settleImmediatePayment(id: string) {
  "use step";
  return await orderWorkflowOperations.settleImmediatePayment(id);
}

export async function prepareEmail(id: string) {
  "use step";
  return await orderWorkflowOperations.prepareEmail(id);
}

export async function sendConfirmation(email: PreparedOrderEmail) {
  "use step";
  await orderWorkflowOperations.sendEmail("created", email);
}

export async function sendShipmentNotice(email: PreparedOrderEmail) {
  "use step";
  await orderWorkflowOperations.sendEmail("shipped", email);
}

export async function closeOrder(id: string) {
  "use step";
  return await orderWorkflowOperations.closeOrder(id);
}
