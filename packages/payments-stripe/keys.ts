import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () => {
  let publishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  if (publishableKey === undefined || publishableKey === "") {
    publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  }
  return createEnv({
    runtimeEnv: {
      STRIPE_PUBLISHABLE_KEY: publishableKey,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    },
    server: {
      STRIPE_PUBLISHABLE_KEY: z.string().trim().startsWith("pk_"),
      STRIPE_SECRET_KEY: z.string().trim().startsWith("sk_"),
    },
  });
};
