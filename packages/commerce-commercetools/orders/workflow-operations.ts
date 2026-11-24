import "server-only";
import { orderWorkflowSteps } from "@repo/commerce-core/orders/workflow-steps";
import { Layer } from "effect";

import { commercetoolsRestClientLayer } from "../client/layers";
import { orderProcessingLayer } from "./processing";

export const orderWorkflowOperations = orderWorkflowSteps(
  orderProcessingLayer.pipe(Layer.provide(commercetoolsRestClientLayer))
);
