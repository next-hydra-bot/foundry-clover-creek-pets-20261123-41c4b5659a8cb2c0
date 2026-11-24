import { accessTokenVerifierLayer } from "@repo/auth/access-token";
import { makeCommerceHttpHandler } from "@repo/commerce-provider/http/runtime";

import {
  CommerceBaseApp,
  orderPrograms,
  purchasingMode,
} from "@/lib/app-runtime";

const commerceHttp = makeCommerceHttpHandler({
  authenticationLayer: accessTokenVerifierLayer(),

  orderPrograms,
  purchasingMode,
  commerceApp: CommerceBaseApp,
  basePath: "/api/commerce",
});

export const GET = async (request: Request) =>
  await commerceHttp.handler(request);
export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;
