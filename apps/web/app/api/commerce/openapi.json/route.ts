import { CommercetoolsCommerceHttpApi } from "@repo/commerce-provider/http/api";
import { OpenApi } from "effect/http-api";

const document = OpenApi.fromApi(
  CommercetoolsCommerceHttpApi.prefix("/api/commerce")
);
export const GET = () => Response.json(document);
