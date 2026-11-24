# Connect proxy deployment

The [webhook recipe](../webhooks/README.md) installs the API receiver independently of Connect. This optional recipe deploys the hosted event sender. Installed feature recipes determine which events it forwards.

## One-time Connector setup

Publish [the proxy Connector](https://github.com/jakala-na/commercetools-connect-proxy) with Connect-managed credentials. Its `connect.yaml` must declare:

```yaml
inheritAs:
  apiClient:
    scopes:
      - manage_subscriptions
```

Connect creates and injects the proxy's runtime credentials. Installers do not create, copy or save that client's ID or secret. Older proxy releases that require supplied commerce credentials must be upgraded to a managed-credential release. Publish the Connector privately for your own Projects; marketplace certification is not required. See [Connect-managed credentials](https://docs.commercetools.com/connect/modify-connector).

## Configure the receiving API

Choose one webhook signing secret and configure the same value in both places:

- The CLI input file passed with `--env-file`: `COMMERCETOOLS_WEBHOOK_SECRET`.
- API runtime configuration: `COMMERCETOOLS_WEBHOOK_SECRET`. For local development, use `apps/api/.env.local`; for hosting, use the API application's environment settings.

API also needs `COMMERCETOOLS_PROJECT_KEY` for this project. If these values already match, there is nothing to copy or change. Restart or redeploy API only when its environment changes.

For catalog events, give API and web the same `REVALIDATION_SECRET`. Bind API to web as `WEB_INTERNAL_URL` on Vercel Services or set API's `REVALIDATION_ENDPOINT` to the full web `/api/revalidate` URL for separate deployments. See [cache invalidation setup](../webhooks/README.md#runtime-configuration).

## Deploy with the application CLI

Run from the composed workspace root:

```sh
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" commerce connect deploy \
  --connector-key <published-proxy-key> --connector-version <published-managed-version> \
  --deployment-key commerce-events \
  --endpoint https://api.example.com/webhooks/commercetools \
  --dry-run
```

Remove `--dry-run` to deploy; add `--yes` to skip confirmation. `--endpoint` is the full public HTTPS API receiver URL, including `/webhooks/commercetools`. Local development can use an ngrok or Tailscale Funnel URL, including its public port.

`--env-file` is read-only input. No local deployment credentials file or `--output` argument is needed. The management input uses `CTP_PROJECT_KEY`, `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`, `CTP_AUTH_URL`, `CTP_API_URL`, `CTP_SCOPES` and the shared `COMMERCETOOLS_WEBHOOK_SECRET`. Supply the scopes actually granted to that API Client. An existing `manage_project:<projectKey>` grant plus `manage_api_clients:<projectKey>` covers these operations. A narrowly scoped client needs:

- `manage_connectors_deployments:<projectKey>` to install and update the proxy.
- `view_connectors:<projectKey>` to inspect the published Connector when installing or upgrading.
- `manage_api_clients:<projectKey>` so Connect can manage the proxy's runtime credentials.
- `manage_subscriptions:<projectKey>` so the CLI can verify the deployed subscription.

Management credentials stay in the CLI and are never sent to the proxy. API/auth hosts must match the region in `CTP_API_URL`. Use a valid management client; the project provisioning command revokes its original bootstrap client.

## Progress, retries and upgrades

The command shows Ora progress in an interactive terminal, including Connect's current deployment status and elapsed time. Piped output and CI receive plain progress messages. The default wait timeout is 900 seconds; `--timeout` accepts up to 3600 seconds. A timeout stops the CLI's wait, not Connect's deployment.

Rerun the same deployment key to find an existing installation or resume waiting after a lost response. The CLI checks its Connector, region, type and installed events using Connect's state. Use `--redeploy` to recover draft or failed installations or apply endpoint and event changes. Webhook secret changes also require `--redeploy`, because Connect does not return stored secret values for comparison. The CLI carries forward any installed `ADDITIONAL_HEADERS`.

Redeploy requires the original deployment key and a matching installed `SUBSCRIPTION_SUFFIX`. To change the key or replace a manually installed proxy with a different suffix, uninstall the existing app in Merchant Center under Connect > Installations. Wait for removal to finish so its uninstall hook can remove the old subscription, then deploy with the desired key without `--redeploy`.

To upgrade, specify the latest published Connector version and `--redeploy`. Connect resolves the latest version when it processes the redeploy. The CLI checks the requested version before submitting the update and verifies the installed version before reporting success. Redeploying with the installed version keeps that version. Changing event selection reruns `postDeploy` with the composed `SUBSCRIPTION_CONFIG` to update the existing subscription.

The default deployment type is `sandbox`. Use `--type production` for production. A different Connector key, deployment type or region requires a different deployment key. The deployment key also distinguishes this installation's Subscription from other installations in the same project.

## Subscription verification

After Connect reports `Deployed`, the CLI reads the project's Subscription. It compares the event filters and the destination with the topic reported for the deployed event app, then prints the Subscription's health. A matching subscription with unhealthy status is reported as action required. The check is read-only.

## Troubleshoot delivery

Use a proxy release that returns `502` to Connect on network failures or any non-`2xx` response from API. It rejects redirects and logs the receiver status, resource and Message ID without logging webhook credentials. Check the shared secret and API's Project key on `401` or `403`, and the exact URL and installed route on `404` or a redirect. Deployment-protection headers can be configured through the Connector's `ADDITIONAL_HEADERS` setting.

Correct the receiver configuration or redeploy the same installation with `--redeploy` while Connect is still retrying. Check for a subsequent `202` in the API logs. Connect discards events after its regional retry window. See the [Connect retry policy](https://docs.commercetools.com/connect/development#retry-policy).
