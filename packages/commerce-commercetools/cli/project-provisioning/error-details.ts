import { Option, Schema } from "effect";

const ErrorDetails = Schema.Struct({
  body: Schema.optionalKey(Schema.Unknown),
  cause: Schema.optionalKey(Schema.Unknown),
  code: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Finite),
  statusCode: Schema.optionalKey(Schema.Finite),
});

const ResourceErrorBody = Schema.Struct({
  errors: Schema.Array(
    Schema.Struct({
      code: Schema.String.check(
        Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]{0,79}$/)
      ),
      message: Schema.optionalKey(Schema.String),
      detailedErrorMessage: Schema.optionalKey(Schema.String),
    })
  ),
});
const decodeResourceErrorBody = Schema.decodeUnknownOption(ResourceErrorBody);

export const decodeErrorDetails = (cause: unknown) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ErrorDetails)(cause));

/** Read only structured resource error fields. SDK errors can also carry the original request. */
export const decodeResourceError = (cause: unknown) => {
  const details = decodeErrorDetails(cause);
  const error = Option.getOrUndefined(decodeResourceErrorBody(details?.body))
    ?.errors[0];
  const message = (
    error?.detailedErrorMessage?.trim() || error?.message?.trim()
  )
    ?.replace(/\s+/g, " ")
    .slice(0, 400);
  return {
    status: details?.statusCode ?? details?.status,
    detail: error && (message ? `${error.code}: ${message}` : error.code),
  };
};

export const decodedErrorMessage = (cause: unknown) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(cause)) ??
  decodeErrorDetails(cause)?.message;

export const providerErrorSummary = (cause: unknown): string | undefined => {
  const details = decodeErrorDetails(cause);
  const message = decodedErrorMessage(cause);
  const status = details?.statusCode ?? details?.status;
  const label = [status, details?.code]
    .filter((part) => part !== undefined)
    .join(" ");

  if (label.length === 0) {
    return message;
  }
  return message === undefined ? label : `${label}: ${message}`;
};
