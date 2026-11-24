import { installContentSearchApp as installCmsSearchApp } from "@repo/cms/content-search-app";
import {
  contentIndexingOperations,
  createContentIndexingHandoff,
  loadContentSearchProjection,
} from "@repo/cms/search";
import { createSearchCommand } from "@repo/search-provider/cli";
import type { ConfigProvider, Effect } from "effect";

import { commerceSearch } from "./commerce-search";

export const createWorkspaceSearchCommand = <E, R>(
  configProvider: Effect.Effect<ConfigProvider.ConfigProvider, E, R>
) =>
  createSearchCommand(configProvider, {
    products: commerceSearch,

    content: {
      indexingOperations: contentIndexingOperations,
      createIndexingHandoff: createContentIndexingHandoff,
      createProjection: loadContentSearchProjection,

      installContentSearchApp: installCmsSearchApp,
    },
  });
