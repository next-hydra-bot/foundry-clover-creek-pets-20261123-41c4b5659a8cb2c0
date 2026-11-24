import { orderWorkflowDispatcher } from "@repo/commerce-core/orders/workflow-events";

import { orderCreatedWorkflow } from "./workflow";
import { orderWorkflowOperations } from "./workflow-operations";

export const dispatchOrderEvent = orderWorkflowDispatcher(
  orderCreatedWorkflow,
  orderWorkflowOperations.readOrder
);
