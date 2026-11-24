import { CheckoutHttpApi } from "@repo/commerce-checkout/http/checkout-api";
import { OpenApi } from "effect/http-api";

const schema = OpenApi.fromApi(CheckoutHttpApi.prefix("/api"));
export const GET = () => Response.json(schema);
