export const orderCreatedMessage = "OrderCreated";
export const orderChangeMessages: readonly string[] = [
  "OrderPaymentStateChanged",
  "OrderPaymentAdded",
  "OrderShipmentStateChanged",
  "OrderStateChanged",
  "OrderEditApplied",
  "DeliveryAdded",
  "DeliveryItemsUpdated",
  "ParcelAddedToDelivery",
  "ParcelItemsUpdated",
  "ParcelTrackingDataUpdated",
];
export const paymentChangeMessages: readonly string[] = [
  "PaymentTransactionAdded",
  "PaymentTransactionStateChanged",
];

export const orderSubscription = {
  changes: [],
  messages: [
    {
      resourceTypeId: "order",
      types: [orderCreatedMessage, ...orderChangeMessages],
    },
    {
      resourceTypeId: "payment",
      types: paymentChangeMessages,
    },
  ],
} as const;
