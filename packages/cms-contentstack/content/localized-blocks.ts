import { Schema } from "effect";

const BlockMetadata = Schema.Struct({
  uid: Schema.NonEmptyString,
  non_localizable_content: Schema.optionalKey(Schema.Boolean),
});

/** Preserve the master block identity and any inheritance metadata from the CMA. */
export function localizedBlockMetadata(input: unknown) {
  return Schema.decodeUnknownSync(BlockMetadata)(input);
}
