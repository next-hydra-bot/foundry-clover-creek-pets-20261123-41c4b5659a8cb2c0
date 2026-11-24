import { Effect, Schema } from "effect";
import {
  DestinationChangeDescriptor,
  DestinationError,
  Tracking,
} from "migrate-sdk";

const CatalogChange = DestinationChangeDescriptor.make(
  "commercetools-catalog-resource-change@v1",
  Schema.Struct({
    operation: Schema.String,
    resourceId: Schema.String,
    resourceVersion: Schema.Int,
  })
);

/** Use for native writes that have no Migrate SDK destination capability. */
export const recordCatalogChange = (
  operation: string,
  resource: { readonly id: string; readonly version: number }
) =>
  Tracking.recordChange(CatalogChange, {
    operation,
    resourceId: resource.id,
    resourceVersion: resource.version,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DestinationError({
          cause,
          message: `Cannot journal acknowledged Commercetools write ${operation}`,
        })
    )
  );
