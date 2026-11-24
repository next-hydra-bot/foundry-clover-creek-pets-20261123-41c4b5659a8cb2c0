import type { CommandReport } from "@repo/cli-core/output-model";

import type { ConnectDeploymentReceipt } from "./model";

export const connectSteps = {
  connector: {
    group: "Connect",
    title: "Check the published Connector and managed credentials",
  },
  create: { group: "Connect", title: "Create the deployment" },
  inspect: { group: "Connect", title: "Check the existing installation" },
  redeploy: { group: "Connect", title: "Apply configuration and redeploy" },
  subscription: {
    group: "Connect",
    title: "Verify the project's event subscription",
  },
  wait: {
    group: "Connect",
    title: "Wait for Connect to build and start the proxy",
  },
} as const;

export const connectDeploymentReport = (
  receipt: ConnectDeploymentReceipt
): CommandReport => {
  const planned = receipt.action.startsWith("would-");
  const { subscription } = receipt;
  const unhealthy =
    subscription !== undefined && subscription.health !== "Healthy";
  const outcome = unhealthy ? "action-required" : "ready";
  return {
    notes: [
      `The receiving API needs COMMERCETOOLS_PROJECT_KEY=${receipt.projectKey} and the same COMMERCETOOLS_WEBHOOK_SECRET as your --env-file.`,
      "Local API: apps/api/.env.local. Hosted API: its environment settings. If already configured, no copying is needed. Restart the API only after changing its environment.",
    ],
    outcome: planned ? "plan" : outcome,
    sections: [
      {
        facts: [
          { label: "Project", value: receipt.projectKey },
          { label: "Deployment", value: receipt.deploymentKey },
          {
            label: "Connector",
            value: `${receipt.connectorKey} · version ${receipt.connectorVersion}`,
          },
          { label: "Action", value: receipt.action },
          { label: "Status", value: receipt.status },
          { label: "API receiver", value: receipt.endpoint },
          {
            label: "Proxy credentials",
            value: planned
              ? "Will be generated and stored by Connect"
              : "Generated and stored by Connect",
          },
        ],
        title: planned ? "Planned installation" : "Installation",
      },
      ...(subscription
        ? [
            {
              facts: [
                { label: "Topic", value: subscription.topic },
                { label: "Health", value: subscription.health },
              ],
              title: "Subscription",
            },
          ]
        : []),
    ],
    summary: planned
      ? "Deployment plan checked. No resources were changed."
      : "The event proxy is deployed and the subscription matches its topic and event filters.",
    tasks: [],
    title: "Commerce events · commercetools Connect",
  };
};
