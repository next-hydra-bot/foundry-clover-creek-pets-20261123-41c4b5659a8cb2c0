import { describe, expect, it } from "vitest";

import { managedAlgoliaResourceNames } from "./managed-resource-names";

describe(managedAlgoliaResourceNames, () => {
  it("omits the scope qualifier when indices have no prefix", () => {
    const names = managedAlgoliaResourceNames(undefined);

    expect({
      algoliaDestinationAuthentication:
        names.algoliaDestinationAuthentication.name,
      commerceApiClient: names.commerceApiClient.name,
      commercetoolsAuthentication: names.commercetoolsAuthentication.name,
      connectorKey: names.connectorKey.name,
      productConnector: names.productConnector("default-store").name,
      productTransformationConfiguration:
        names.productTransformationConfiguration("default-store").name,
      searchKey: names.searchKey.name,
    }).toEqual({
      algoliaDestinationAuthentication:
        "Managed Algolia destination authentication",
      commerceApiClient: "Managed Algolia connector",
      commercetoolsAuthentication: "Managed commercetools authentication",
      connectorKey: "Managed connector key",
      productConnector: "Managed Product connector (default-store)",
      productTransformationConfiguration:
        "Managed Product transformation configuration (default-store)",
      searchKey: "Managed runtime search key",
    });
  });

  it("uses a real prefix to distinguish independently managed resources", () => {
    const names = managedAlgoliaResourceNames("staging");

    expect({
      connectorKey: names.connectorKey,
      productConnector: names.productConnector("default-store"),
    }).toEqual({
      connectorKey: {
        legacyNames: [],
        name: "Managed connector key (staging)",
      },
      productConnector: {
        legacyNames: [],
        name: "Managed Product connector (staging/default-store)",
      },
    });
  });
});
