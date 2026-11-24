import {
  adminImpersonationAuthenticationLayer,
  makeImpersonationHttpHandler,
} from "@repo/auth-contract/impersonation-http";
import { accessTokenVerifierLayer } from "@repo/auth/access-token";
import { impersonationLayer } from "@repo/auth/impersonation";
import { authUsersLayer } from "@repo/auth/users";
import { Layer } from "effect";

const transport = makeImpersonationHttpHandler({
  authentication: adminImpersonationAuthenticationLayer.pipe(
    Layer.provide(accessTokenVerifierLayer({ configPrefix: "ADMIN" }))
  ),
  services: Layer.mergeAll(impersonationLayer, authUsersLayer),
});
export const GET = transport.handler;
export const POST = transport.handler;
