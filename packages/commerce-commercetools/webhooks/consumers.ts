import { orderEventConsumer } from "../orders/event-consumer";
import { catalogEventConsumer } from "../product/events";
import { handleCommercetoolsWebhook } from "./receiver";

export const handleCommerceEvent = async (request: Request) =>
  await handleCommercetoolsWebhook(request, [
    catalogEventConsumer,
    orderEventConsumer,
  ]);
