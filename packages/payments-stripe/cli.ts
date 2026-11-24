import { privateDotEnvFileLayer } from "@repo/cli-core/private-dotenv";
import {
  Config,
  ConfigProvider,
  Console,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { CliError, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import {
  provisionStripeSandbox,
  StripeProvisioningError,
} from "./provisioning";

const encodeReceipt = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      accountId: Schema.String,
      configurationId: Schema.String,
      webhook: Schema.optional(
        Schema.Struct({ id: Schema.String, output: Schema.String })
      ),
    })
  )
);

export const createPaymentsCommand = <E, R>(
  configProvider: Effect.Effect<ConfigProvider.ConfigProvider, E, R>
) => {
  const provision = Command.make(
    "provision",
    {
      accountId: Flag.String("account-id").pipe(
        Flag.optional,
        Flag.withDescription(
          "Expected Stripe sandbox account ID. Required for an organization key."
        )
      ),
      webhookEvent: Flag.String("webhook-event").pipe(
        Flag.atLeast(0),
        Flag.withDescription(
          "Stripe event type handled by the webhook; repeat as needed"
        )
      ),
      webhookOutput: Flag.String("webhook-output").pipe(
        Flag.optional,
        Flag.withDescription(
          "Private dotenv path for the signing secret; reuse it on retry"
        )
      ),
      webhookUrl: Flag.String("webhook-url").pipe(
        Flag.optional,
        Flag.withDescription(
          "Public HTTPS URL of the running Stripe webhook receiver"
        )
      ),
    },
    (flags) =>
      Effect.gen(function* () {
        const provider = yield* configProvider.pipe(
          Effect.mapError(
            () =>
              new StripeProvisioningError({
                message:
                  "Could not load the private CLI environment file. Use an absolute --env-file path.",
              })
          )
        );
        const key = yield* Config.schema(
          Schema.RedactedFromValue(Schema.NonEmptyString),
          "STRIPE_PROVISIONING_KEY"
        ).pipe(
          Config.orElse(() =>
            Config.schema(
              Schema.RedactedFromValue(Schema.NonEmptyString),
              "STRIPE_SECRET_KEY"
            )
          ),
          Effect.provideService(ConfigProvider.ConfigProvider, provider),
          Effect.mapError(
            () =>
              new StripeProvisioningError({
                message:
                  "Set STRIPE_PROVISIONING_KEY or STRIPE_SECRET_KEY in the private --env-file or command environment.",
              })
          )
        );
        const receipt = yield* provisionStripeSandbox(
          Option.getOrUndefined(flags.accountId),
          key,
          {
            events: flags.webhookEvent,
            output: Option.getOrUndefined(flags.webhookOutput),
            url: Option.getOrUndefined(flags.webhookUrl),
          }
        );
        yield* Console.log(encodeReceipt(receipt));
      }).pipe(
        Effect.provide(
          Layer.merge(privateDotEnvFileLayer, FetchHttpClient.layer)
        ),
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "error",
        }),
        Effect.mapError(
          (error) =>
            new CliError.UserError({
              cause: undefined,
              userMessage: Schema.is(StripeProvisioningError)(error)
                ? error.message
                : "Could not access the private Stripe webhook output. Check its path and permissions.",
            })
        )
      )
  ).pipe(
    Command.withDescription(
      "Configure cards and an optional webhook for an existing Stripe sandbox"
    )
  );

  return Command.make("payments").pipe(
    Command.withDescription("Manage workspace payments"),
    Command.withSubcommands([provision])
  );
};
