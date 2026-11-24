import { bundledCatalogFiles } from "@repo/commerce-core/catalog/files";

import { defineCatalogMigrationConfig } from "./migration-config";

export default defineCatalogMigrationConfig({
  catalogs: bundledCatalogFiles,
  stateDirectory: new URL(".migrate/", import.meta.url),
});
