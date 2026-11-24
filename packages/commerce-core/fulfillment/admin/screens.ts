import { FULFILLMENT_READ_PERMISSION } from "../permissions";

export const fulfillmentAdminScreens = [
  {
    description: "Pack deliveries and ship parcels for Orders.",
    href: "/fulfillment",
    permissions: [FULFILLMENT_READ_PERMISSION],
    title: "Fulfillment",
  },
] as const;
