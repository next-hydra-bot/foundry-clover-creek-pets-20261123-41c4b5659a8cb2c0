import "server-only";
import { PostHog } from "posthog-node";

import { keys } from "../keys";

const { NEXT_PUBLIC_POSTHOG_HOST: host, NEXT_PUBLIC_POSTHOG_KEY: key } = keys();

export const analytics =
  key && host
    ? new PostHog(key, {
        host,
        // Flush immediately in serverless environments.
        flushAt: 1,
        flushInterval: 0,
      })
    : undefined;
