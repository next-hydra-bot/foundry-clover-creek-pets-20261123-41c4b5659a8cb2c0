import { mergeTests } from "@playwright/test";
import { test as base } from "@repo/e2e-testing";

export const test = mergeTests(base);
