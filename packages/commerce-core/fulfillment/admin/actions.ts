import "server-only";
import { Data, Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClientError } from "effect/http";

import { OrderId } from "../../domain/order-identity";
import { fulfillmentOutcomeUnknown } from "../api";
import { PackDeliveryInput, ShipParcelInput } from "../model";
import { fulfillmentHttpClient } from "./client";

export interface FulfillmentActionResult {
  readonly ok: boolean;
  readonly message: string;
}
export type FulfillmentAction = (
  form: FormData
) => Promise<FulfillmentActionResult>;
const SafeError = Schema.Struct({
  _tag: Schema.Literals([
    "FulfillmentApiConflict",
    "FulfillmentApiOutcomeUnknown",
    "FulfillmentApiForbidden",
    "FulfillmentApiUnauthorized",
    "FulfillmentApiUnavailable",
    "InputInvalid",
  ]),
  message: Schema.String,
});
export const fulfillmentErrorMessage = (cause: unknown) =>
  Option.match(Schema.decodeUnknownOption(SafeError)(cause), {
    onNone: () =>
      "Fulfillment could not be loaded or saved. Check its API configuration and refresh before trying again.",
    onSome: (error) => error.message,
  });
const FormFields = Schema.Struct({
  locale: Schema.NonEmptyString,
  orderId: OrderId,
  revision: Schema.NonEmptyString,
});
export const fulfillmentCommandFromForm = (form: FormData) =>
  Effect.gen(function* () {
    const fields = yield* Schema.decodeUnknownEffect(FormFields)({
      locale: form.get("locale"),
      orderId: form.get("orderId"),
      revision: form.get("revision"),
    });
    const items = yield* Effect.forEach(
      [...form.entries()].filter(([key]) => key.startsWith("quantity:")),
      ([key, value]) =>
        Schema.decodeUnknownEffect(
          Schema.Struct({
            lineItemId: Schema.NonEmptyString,
            quantity: Schema.FiniteFromString.check(
              Schema.isInt(),
              Schema.isGreaterThanOrEqualTo(0),
              Schema.makeFilter(Number.isSafeInteger)
            ),
          })
        )({ lineItemId: key.slice("quantity:".length), quantity: value })
    );
    return { ...fields, items: items.filter((item) => item.quantity > 0) };
  });
class FulfillmentFormInvalid extends Data.TaggedError(
  "FulfillmentFormInvalid"
)<{
  readonly cause: Schema.SchemaError;
}> {}

const validatedCommand = (operation: "pack" | "ship", form: FormData) =>
  Effect.gen(function* () {
    const { locale, orderId, ...fields } =
      yield* fulfillmentCommandFromForm(form);
    if (operation === "pack") {
      const payload = yield* Schema.decodeUnknownEffect(PackDeliveryInput)({
        ...fields,
        groupId: form.get("groupId"),
      });
      return { locale, operation: "pack" as const, orderId, payload };
    }
    const carrierValue = yield* Schema.decodeUnknownEffect(
      Schema.NullOr(Schema.String)
    )(form.get("carrier"));
    const carrier =
      carrierValue === null || carrierValue.trim() === ""
        ? undefined
        : carrierValue.trim();
    const numberValue = yield* Schema.decodeUnknownEffect(
      Schema.NullOr(Schema.String)
    )(form.get("trackingNumber"));
    const number =
      numberValue === null || numberValue.trim() === ""
        ? undefined
        : numberValue.trim();
    const tracking =
      carrier !== undefined || number !== undefined
        ? { carrier, number }
        : undefined;
    const payload = yield* Schema.decodeUnknownEffect(ShipParcelInput)({
      ...fields,
      deliveryId: form.get("deliveryId"),
      tracking,
    });
    return { locale, operation: "ship" as const, orderId, payload };
  }).pipe(Effect.mapError((cause) => new FulfillmentFormInvalid({ cause })));

/** Validate before sending; any response/transport decode failure after submission requires refresh. */
export const submitFulfillmentEffect = (
  operation: "pack" | "ship",
  form: FormData,
  accessToken: string | undefined
) => {
  if (!accessToken) {
    return Effect.succeed({
      message: "Sign in again before updating fulfillment.",
      ok: false,
    });
  }
  return Effect.gen(function* () {
    const command = yield* validatedCommand(operation, form);
    const client = yield* fulfillmentHttpClient(accessToken);
    const request = {
      params: { id: command.orderId },
      query: { locale: command.locale },
      responseMode: "decoded-only" as const,
    };
    yield* (
      command.operation === "pack"
        ? client.fulfillment.pack({ ...request, payload: command.payload })
        : client.fulfillment.ship({ ...request, payload: command.payload })
    ).pipe(
      Effect.mapError((error) =>
        Schema.isSchemaError(error) || HttpClientError.isHttpClientError(error)
          ? fulfillmentOutcomeUnknown.make({
              message:
                "The write could not be confirmed. Refresh the Order before trying again.",
            })
          : error
      )
    );
    return {
      message: operation === "pack" ? "Delivery packed." : "Parcel shipped.",
      ok: true,
    };
  }).pipe(
    Effect.catchTag("FulfillmentFormInvalid", () =>
      Effect.succeed({
        message: "Enter positive whole quantities for at least one item.",
        ok: false,
      })
    ),
    Effect.catch((error) =>
      Effect.succeed({ message: fulfillmentErrorMessage(error), ok: false })
    )
  );
};

export const submitFulfillment = async (
  operation: "pack" | "ship",
  form: FormData,
  accessToken: string | undefined
): Promise<FulfillmentActionResult> =>
  await Effect.runPromise(
    submitFulfillmentEffect(operation, form, accessToken).pipe(
      Effect.provide(FetchHttpClient.layer)
    )
  );
