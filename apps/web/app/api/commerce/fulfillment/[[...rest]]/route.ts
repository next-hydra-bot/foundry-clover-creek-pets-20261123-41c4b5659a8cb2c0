import { accessTokenVerifierLayer } from "@repo/auth/access-token";
import { makeCommercetoolsFulfillmentHandler } from "@repo/commerce-provider/fulfillment/http";

const transport = makeCommercetoolsFulfillmentHandler(
  accessTokenVerifierLayer({ configPrefix: "ADMIN" })
);
export const GET = async (request: Request) => await transport.handler(request);
export const POST = GET;
