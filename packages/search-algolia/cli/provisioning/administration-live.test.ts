import { Effect, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { ConfigureAlgoliaQuerySuggestionsOptions } from "./administration";
import type { AlgoliaAdministrationClients } from "./administration-live";
import { makeAlgoliaAdministration } from "./administration-live";

const makeClients = () => {
  const pagination = { itemsPerPage: 100, nbItems: 0, nbPages: 0, page: 1 };
  const addApiKey = vi
    .fn<AlgoliaAdministrationClients["search"]["addApiKey"]>()
    .mockResolvedValue({ createdAt: "2026-09-02T00:00:00Z", key: "new-key" });
  const createConfig = vi
    .fn<AlgoliaAdministrationClients["querySuggestions"]["createConfig"]>()
    .mockResolvedValue({ status: 200 });
  const getAllConfigs = vi
    .fn<AlgoliaAdministrationClients["querySuggestions"]["getAllConfigs"]>()
    .mockResolvedValue([]);
  const getLogs = vi
    .fn<AlgoliaAdministrationClients["search"]["getLogs"]>()
    .mockResolvedValue({ logs: [] });
  const listApiKeys = vi
    .fn<AlgoliaAdministrationClients["search"]["listApiKeys"]>()
    .mockResolvedValue({ keys: [] });
  const setSettings = vi
    .fn<AlgoliaAdministrationClients["search"]["setSettings"]>()
    .mockResolvedValue({ taskID: 42, updatedAt: "2026-09-02T00:00:00Z" });
  const getSettings = vi
    .fn<AlgoliaAdministrationClients["search"]["getSettings"]>()
    .mockResolvedValue({});
  const updateApiKey = vi
    .fn<AlgoliaAdministrationClients["search"]["updateApiKey"]>()
    .mockResolvedValue({ key: "existing-key", updatedAt: "2026-09-02" });
  const updateConfig = vi
    .fn<AlgoliaAdministrationClients["querySuggestions"]["updateConfig"]>()
    .mockResolvedValue({ status: 200 });
  const waitForApiKey = vi
    .fn<AlgoliaAdministrationClients["search"]["waitForApiKey"]>()
    .mockResolvedValue(undefined);
  const waitForTask = vi
    .fn<AlgoliaAdministrationClients["search"]["waitForTask"]>()
    .mockResolvedValue({ status: "published" });
  const createAuthentication = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["createAuthentication"]>()
    .mockResolvedValue({
      authenticationID: "authentication-id",
      createdAt: "2026-09-02T00:00:00Z",
      name: "authentication",
    });
  const createDestination = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["createDestination"]>()
    .mockResolvedValue({
      createdAt: "2026-09-02T00:00:00Z",
      destinationID: "destination-id",
      name: "destination",
    });
  const createSource = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["createSource"]>()
    .mockResolvedValue({
      createdAt: "2026-09-02T00:00:00Z",
      name: "source",
      sourceID: "source-id",
    });
  const createTask = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["createTask"]>()
    .mockResolvedValue({
      createdAt: "2026-09-02T00:00:00Z",
      taskID: "task-id",
    });
  const createTransformation = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["createTransformation"]>()
    .mockResolvedValue({
      createdAt: "2026-09-02T00:00:00Z",
      transformationID: "transformation-id",
    });
  const getRun = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["getRun"]>()
    .mockResolvedValue({
      appID: "application-id",
      createdAt: "2026-09-02T00:00:00Z",
      finishedAt: "2026-09-02T00:00:01Z",
      outcome: "success",
      runID: "run-id",
      status: "finished",
      taskID: "task-id",
      type: "reindex",
    });
  const listAuthentications = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["listAuthentications"]>()
    .mockResolvedValue({ authentications: [], pagination });
  const listDestinations = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["listDestinations"]>()
    .mockResolvedValue({ destinations: [], pagination });
  const listEvents = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["listEvents"]>()
    .mockResolvedValue({
      events: [],
      pagination,
      window: {
        endDate: "2026-09-02T01:00:00Z",
        startDate: "2026-09-02T00:00:00Z",
      },
    });
  const listSources = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["listSources"]>()
    .mockResolvedValue({ pagination, sources: [] });
  const listTasks = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["listTasks"]>()
    .mockResolvedValue({ pagination, tasks: [] });
  const listTransformations = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["listTransformations"]>()
    .mockResolvedValue({ pagination, transformations: [] });
  const replaceTask = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["replaceTask"]>()
    .mockResolvedValue({
      taskID: "task-id",
      updatedAt: "2026-09-02T00:00:00Z",
    });
  const runTask = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["runTask"]>()
    .mockResolvedValue({
      createdAt: "2026-09-02T00:00:00Z",
      runID: "run-id",
    });
  const tryTransformationBeforeUpdate = vi
    .fn<
      AlgoliaAdministrationClients["ingestion"]["tryTransformationBeforeUpdate"]
    >()
    .mockResolvedValue({ payloads: ["{}"] });
  const updateAuthentication = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["updateAuthentication"]>()
    .mockResolvedValue({
      authenticationID: "authentication-id",
      name: "authentication",
      updatedAt: "2026-09-02T00:00:00Z",
    });
  const updateDestination = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["updateDestination"]>()
    .mockResolvedValue({
      destinationID: "destination-id",
      name: "destination",
      updatedAt: "2026-09-02T00:00:00Z",
    });
  const updateSource = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["updateSource"]>()
    .mockResolvedValue({
      name: "source",
      sourceID: "source-id",
      updatedAt: "2026-09-02T00:00:00Z",
    });
  const updateTransformation = vi
    .fn<AlgoliaAdministrationClients["ingestion"]["updateTransformation"]>()
    .mockResolvedValue({
      transformationID: "transformation-id",
      updatedAt: "2026-09-02T00:00:00Z",
    });

  return {
    clients: {
      ingestion: {
        createAuthentication,
        createDestination,
        createSource,
        createTask,
        createTransformation,
        getRun,
        listAuthentications,
        listDestinations,
        listEvents,
        listSources,
        listTasks,
        listTransformations,
        replaceTask,
        runTask,
        tryTransformationBeforeUpdate,
        updateAuthentication,
        updateDestination,
        updateSource,
        updateTransformation,
      },
      querySuggestions: {
        createConfig,
        getAllConfigs,
        updateConfig,
      },
      search: {
        addApiKey,
        getSettings,
        getLogs,
        listApiKeys,
        setSettings,
        updateApiKey,
        waitForApiKey,
        waitForTask,
      },
    } satisfies AlgoliaAdministrationClients,
    spies: {
      addApiKey,
      createAuthentication,
      createConfig,
      createDestination,
      createSource,
      createTask,
      createTransformation,
      getAllConfigs,
      getLogs,
      getRun,
      getSettings,
      listApiKeys,
      listAuthentications,
      listEvents,
      listSources,
      runTask,
      setSettings,
      tryTransformationBeforeUpdate,
      updateApiKey,
      updateAuthentication,
      updateConfig,
      updateSource,
      updateTransformation,
      waitForApiKey,
      waitForTask,
    },
  };
};

describe(makeAlgoliaAdministration, () => {
  it("reconciles CMS clear permission without granting Product access or settings changes", async () => {
    const { clients, spies } = makeClients();
    const administration = makeAlgoliaAdministration(clients);
    const description = "CMS writer for this deployment";
    await administration
      .configureContentKey({
        description,
        indexNames: ["staging--content"],
        operations: ["list-indices", "search", "upsert", "delete"],
      })
      .pipe(Effect.runPromise);
    expect(spies.addApiKey.mock.calls[0]?.[0]).toEqual({
      acl: ["listIndexes", "search", "addObject", "deleteObject"],
      description,
      indexes: ["staging--content"],
    });
    spies.listApiKeys.mockResolvedValue({
      keys: [
        {
          acl: ["search", "addObject", "deleteObject"],
          createdAt: 1,
          description,
          indexes: ["staging--content"],
          validity: 0,
          value: "new-key",
        },
      ],
    });
    await administration
      .configureContentKey({
        description,
        indexNames: ["content"],
        operations: [
          "list-indices",
          "search",
          "browse",
          "upsert",
          "delete",
          "clear",
        ],
      })
      .pipe(Effect.runPromise);
    expect(spies.addApiKey).toHaveBeenCalledOnce();
    expect(spies.updateApiKey).toHaveBeenCalledWith({
      apiKey: {
        acl: [
          "listIndexes",
          "search",
          "browse",
          "addObject",
          "deleteObject",
          "deleteIndex",
        ],
        description,
        indexes: ["content"],
      },
      key: "new-key",
    });
    expect(spies.waitForApiKey).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: "new-key",
        operation: "update",
      })
    );
  });

  it("preserves matching index settings without scheduling another write", async () => {
    const { clients, spies } = makeClients();
    spies.getSettings.mockResolvedValue({
      searchableAttributes: ["productCard.title"],
      distinct: false,
    });
    await makeAlgoliaAdministration(clients)
      .configureIndex({
        indexName: "products--store--en-US",
        settings: {
          searchableAttributes: ["productCard.title"],
          distinct: false,
        },
      })
      .pipe(Effect.runPromise);
    expect(spies.setSettings).not.toHaveBeenCalled();
    expect(spies.waitForTask).not.toHaveBeenCalled();
  });

  it("creates index settings when the native index is absent", async () => {
    const { clients, spies } = makeClients();
    spies.getSettings.mockRejectedValue({
      status: 404,
      message: "Index does not exist",
    });
    await makeAlgoliaAdministration(clients)
      .configureIndex({
        indexName: "products--store--en-US",
        settings: { searchableAttributes: ["productCard.title"] },
      })
      .pipe(Effect.runPromise);
    expect(spies.setSettings).toHaveBeenCalledExactlyOnceWith({
      indexName: "products--store--en-US",
      indexSettings: { searchableAttributes: ["productCard.title"] },
    });
  });

  it("waits for index settings and creates idempotent Query Suggestions configuration", async () => {
    const { clients, spies } = makeClients();
    const administration = makeAlgoliaAdministration(clients);

    await administration
      .configureIndex({
        indexName: "acceptance--content",
        settings: { searchableAttributes: ["contentCard.title"] },
      })
      .pipe(Effect.runPromise);
    const suggestions = {
      indexName: "acceptance--query-suggestions--store--en-US",
      language: "en",
      sources: [
        {
          analyticsTags: ["environment:acceptance|locale:en-us"],
          indexName: "acceptance--products--store",
        },
        {
          analyticsTags: ["environment:acceptance|locale:en-us"],
          indexName: "acceptance--content",
        },
      ],
    } satisfies ConfigureAlgoliaQuerySuggestionsOptions;
    await administration
      .configureQuerySuggestions(suggestions)
      .pipe(Effect.runPromise);
    await administration
      .configureQuerySuggestions(suggestions)
      .pipe(Effect.runPromise);

    expect(spies.waitForTask).toHaveBeenCalledWith({
      indexName: "acceptance--content",
      taskID: 42,
    });
    expect(spies.createConfig).toHaveBeenCalledExactlyOnceWith({
      indexName: suggestions.indexName,
      languages: ["en"],
      sourceIndices: [
        {
          analyticsTags: suggestions.sources[0]?.analyticsTags,
          indexName: suggestions.sources[0]?.indexName,
          minHits: 1,
          minLetters: 3,
          replicas: false,
        },
        {
          analyticsTags: suggestions.sources[1]?.analyticsTags,
          indexName: suggestions.sources[1]?.indexName,
          minHits: 1,
          minLetters: 3,
          replicas: false,
        },
      ],
    });
    expect(spies.updateConfig).toHaveBeenCalledOnce();
    expect(spies.getAllConfigs).toHaveBeenCalledOnce();
  });

  it("creates one search-only key restricted to the derived index allow-list", async () => {
    const { clients, spies } = makeClients();
    const administration = makeAlgoliaAdministration(clients);

    const key = await administration
      .configureSearchKey({
        description: "Managed runtime search key (acceptance)",
        indexNames: ["acceptance--products--store", "acceptance--content"],
      })
      .pipe(Effect.runPromise);

    expect(Redacted.value(key)).toBe("new-key");
    expect(spies.addApiKey).toHaveBeenCalledWith({
      acl: ["search"],
      description: "Managed runtime search key (acceptance)",
      indexes: ["acceptance--products--store", "acceptance--content"],
    });
    expect(spies.waitForApiKey).toHaveBeenCalledWith({
      key: "new-key",
      operation: "add",
    });
  });

  it("creates a scoped connector key and a Store-specific native connector", async () => {
    const { clients, spies } = makeClients();
    const administration = makeAlgoliaAdministration(clients);

    const connectorKey = await administration
      .configureConnectorKey({
        description: "Managed connector key (acceptance)",
        indexNames: ["acceptance--products--default-store"],
      })
      .pipe(Effect.runPromise);
    const destinationAuthenticationId = await administration
      .configureAlgoliaDestinationAuthentication({
        apiKey: connectorKey,
        applicationId: "application-id",
        name: "Managed destination authentication (acceptance)",
      })
      .pipe(Effect.runPromise);
    const transformationAuthenticationId = await administration
      .configureAlgoliaTransformationSecrets({
        name: "Managed Product transformation configuration (acceptance/default-store)",
        values: {
          CONFIGURATION: '{"version":4}',
        },
      })
      .pipe(Effect.runPromise);
    const receipt = await administration
      .configureCommercetoolsConnector({
        algoliaAuthenticationId: destinationAuthenticationId,
        commercetoolsAuthenticationId: "commercetools-authentication-id",
        indexName: "acceptance--products--default-store",
        locales: ["en-US", "es-ES"],
        name: "Managed Product connector (acceptance/default-store)",
        projectKey: "project-key",
        storeKey: "default-store",
        transformationAuthenticationIds: [transformationAuthenticationId],
        transformationCode:
          "async function transform(record) { return [record]; }",
        url: "https://api.us-central1.gcp.commercetools.com",
      })
      .pipe(Effect.runPromise);

    expect(spies.addApiKey).toHaveBeenCalledWith({
      acl: [
        "addObject",
        "deleteObject",
        "deleteIndex",
        "editSettings",
        "listIndexes",
        "settings",
      ],
      description: "Managed connector key (acceptance)",
      indexes: [
        "acceptance--products--default-store",
        "acceptance--products--default-store-temp-*",
      ],
    });
    expect({
      authentication: spies.createAuthentication.mock.calls[1]?.[0],
      getRun: spies.getRun.mock.calls,
      runTask: spies.runTask.mock.calls,
      transformation: spies.createTransformation.mock.calls[0]?.[0],
      transformationValidation: spies.tryTransformationBeforeUpdate.mock.calls,
    }).toMatchObject({
      authentication: {
        input: {
          CONFIGURATION: '{"version":4}',
        },
        name: "Managed Product transformation configuration (acceptance/default-store)",
        type: "secrets",
      },
      getRun: [[{ runID: "run-id" }]],
      runTask: [[{ taskID: "task-id" }]],
      transformation: {
        authenticationIDs: [transformationAuthenticationId],
      },
      transformationValidation: [
        [
          {
            transformationID: "transformation-id",
            transformationTry: {
              sampleRecord: {
                objectID: "provisioning-validation-product",
                variants: [],
              },
              type: "code",
            },
          },
        ],
      ],
    });
    const [sourceOptions] = spies.createSource.mock.calls.at(0) ?? [];
    expect(sourceOptions?.input).toMatchObject({
      locales: ["en-US", "es-ES"],
      storeKeys: ["default-store"],
    });
    expect(receipt).toMatchObject({
      destinationId: "destination-id",
      runId: "run-id",
      sourceId: "source-id",
      taskId: "task-id",
      transformationId: "transformation-id",
    });
  });

  it("surfaces the failed initial reindex and its observability events", async () => {
    const { clients, spies } = makeClients();
    spies.getRun.mockResolvedValueOnce({
      appID: "application-id",
      createdAt: "2026-09-02T00:00:00Z",
      finishedAt: "2026-09-02T00:00:01Z",
      outcome: "failure",
      reason: "Too many transformation errors",
      reasonCode: "too_many_errors",
      runID: "run-id",
      status: "finished",
      taskID: "task-id",
      type: "reindex",
    });
    spies.listEvents.mockResolvedValueOnce({
      events: [
        {
          batchSize: 1,
          data: { message: "Missing transformation configuration" },
          eventID: "event-id",
          publishedAt: "2026-09-02T00:00:01Z",
          runID: "run-id",
          status: "critical",
          type: "transform",
        },
      ],
      pagination: { itemsPerPage: 100, nbItems: 1, nbPages: 1, page: 1 },
      window: {
        endDate: "2026-09-02T01:00:00Z",
        startDate: "2026-09-02T00:00:00Z",
      },
    });
    const administration = makeAlgoliaAdministration(clients);

    const error = await administration
      .configureCommercetoolsConnector({
        algoliaAuthenticationId: "algolia-authentication-id",
        commercetoolsAuthenticationId: "commercetools-authentication-id",
        indexName: "acceptance--products--default-store",
        locales: ["en-US"],
        name: "Managed Product connector (acceptance/default-store)",
        projectKey: "project-key",
        storeKey: "default-store",
        transformationAuthenticationIds: ["configuration-authentication-id"],
        transformationCode:
          "async function transform(record) { return [record]; }",
        url: "https://api.us-central1.gcp.commercetools.com",
      })
      .pipe(Effect.flip, Effect.runPromise);

    expect({
      cause: String(error.cause),
      message: error.message,
      operation: error.operation,
    }).toEqual({
      cause:
        'Error: Run run-id finished with outcome failure: Too many transformation errors. Events: transform/critical: {"message":"Missing transformation configuration"}',
      message: "Algolia initial reindex run failed",
      operation: "initial reindex run",
    });
    expect(spies.getLogs).not.toHaveBeenCalled();
  });

  it("surfaces matching application errors when a failed run has no events", async () => {
    const { clients, spies } = makeClients();
    spies.getRun.mockResolvedValueOnce({
      appID: "application-id",
      createdAt: "2026-09-02T00:00:00Z",
      finishedAt: "2026-09-02T00:00:01Z",
      outcome: "failure",
      reason: "run failed because of a critical event",
      reasonCode: "critical",
      runID: "run-id",
      status: "finished",
      taskID: "task-id",
      type: "reindex",
    });
    spies.getLogs.mockResolvedValueOnce({
      logs: [
        {
          answer: '{"message":"Index not allowed with this API key"}',
          answer_code: "403",
          index: "acceptance--products--default-store-temp-run-id",
          ip: "127.0.0.1",
          method: "DELETE",
          processing_time_ms: "1",
          query_body: "",
          query_headers: "",
          sha1: "sha1",
          timestamp: "2026-09-02T00:00:01Z",
          url: "/1/indexes/acceptance--products--default-store-temp-run-id",
        },
      ],
    });
    const administration = makeAlgoliaAdministration(clients);

    const error = await administration
      .configureCommercetoolsConnector({
        algoliaAuthenticationId: "algolia-authentication-id",
        commercetoolsAuthenticationId: "commercetools-authentication-id",
        indexName: "acceptance--products--default-store",
        locales: ["en-US"],
        name: "Managed Product connector (acceptance/default-store)",
        projectKey: "project-key",
        storeKey: "default-store",
        transformationAuthenticationIds: ["configuration-authentication-id"],
        transformationCode:
          "async function transform(record) { return [record]; }",
        url: "https://api.us-central1.gcp.commercetools.com",
      })
      .pipe(Effect.flip, Effect.runPromise);

    expect(String(error.cause)).toContain(
      'Application logs: DELETE /1/indexes/acceptance--products--default-store-temp-run-id -> 403: {"message":"Index not allowed with this API key"}'
    );
  });
});
