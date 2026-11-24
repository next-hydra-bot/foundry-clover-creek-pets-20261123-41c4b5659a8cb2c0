import { Cause, Formatter } from "effect";
import { CliError } from "effect/cli";

export const searchCliError = <E>(cause: Cause.Cause<E>) =>
  new CliError.UserError({
    cause: Cause.squash(cause),
    userMessage: Cause.prettyErrors(cause)
      .map((error) => Formatter.format(error))
      .join("\n  "),
  });
