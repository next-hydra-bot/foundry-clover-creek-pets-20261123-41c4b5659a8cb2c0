import { keys as auth } from "@repo/auth/keys";
import { configurePortlessEnvironment } from "@repo/next-config/portless";
import { keys as observability } from "@repo/observability/keys";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

configurePortlessEnvironment("admin");

export const env = createEnv({
  extends: [auth(), observability()],
  runtimeEnv: {
    ANALYZE: process.env.ANALYZE,
    VERCEL: process.env.VERCEL,
  },
  server: {
    ANALYZE: z.string().optional(),
    VERCEL: z.string().optional(),
  },
});
