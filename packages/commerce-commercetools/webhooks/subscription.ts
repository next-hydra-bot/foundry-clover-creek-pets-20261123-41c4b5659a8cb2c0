import { catalogSubscription } from "../product/subscription";
import { orderSubscription } from "./../orders/subscription";
import { combineSubscriptions } from "./subscriptions";

export const commerceEventSubscription = combineSubscriptions([
  catalogSubscription,
  orderSubscription,
]);
