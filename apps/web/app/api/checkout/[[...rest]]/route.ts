import { accessTokenVerifierLayer } from "@repo/auth/access-token";
import { makeCheckoutHttpHandler } from "@repo/commerce-checkout/http/runtime";

import { CommerceApp } from "@/lib/app-runtime";

const checkout = makeCheckoutHttpHandler({
  authenticationLayer: accessTokenVerifierLayer(),
  commerceApp: CommerceApp,
  basePath: "/api",
});

export const GET = async (request: Request) => await checkout.handler(request);
export const POST = GET;
