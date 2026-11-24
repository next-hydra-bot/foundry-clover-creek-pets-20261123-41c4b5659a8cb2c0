import { makePublicCatalogRuntime } from "@repo/commerce-core/product/public-catalog-runtime";
import { Layer } from "effect";

import {
  commercetoolsClientsLayer,
  commercetoolsConfigLayer,
} from "../client/layers";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This provider binding composes public catalog discovery.
import { commercetoolsProductDiscoveryClientLayerWith } from "./client-live";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This provider binding composes public catalog discovery.
import { productDiscoveryLayerWithClient } from "./product-discovery";

const discovery = productDiscoveryLayerWithClient(
  commercetoolsProductDiscoveryClientLayerWith({
    cacheStoreConfiguration: false,
  }).pipe(
    Layer.provide(
      Layer.merge(commercetoolsClientsLayer, commercetoolsConfigLayer)
    )
  )
);

// Product Search is eventually consistent; webhooks alone cannot justify a long lifetime.
export const PublicCatalog = makePublicCatalogRuntime(discovery, "hours");
