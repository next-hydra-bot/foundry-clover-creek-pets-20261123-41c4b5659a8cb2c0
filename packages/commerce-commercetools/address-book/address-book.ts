import type {
  BusinessUnit,
  BusinessUnitUpdateAction,
  Customer,
  CustomerUpdateAction,
  ByProjectKeyRequestBuilder,
  Address as CommercetoolsAddress,
} from "@commercetools/platform-sdk";
import {
  AddressBookAccessDenied,
  AddressBookEntry,
  AddressBookEntryNotFound,
  AddressBookProviderFailure,
  AddressBookWriteOutcomeUnknown,
  addressBookMutationRejected,
  normalizeAddressTypes,
} from "@repo/commerce-core/domain/address-book";
import type {
  AddressBookOperation,
  AddressBookReference,
  AddressType,
  SaveAddressBookEntryInput,
} from "@repo/commerce-core/domain/address-book";
import type { AuthenticatedCommercePrincipal } from "@repo/commerce-core/domain/commerce-request-context";
import type { ProviderFailureReason } from "@repo/commerce-core/domain/provider-failure";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Effect, Layer, Option, Schema } from "effect";

import { commercetoolsClientsLayer } from "../client/layers";
import { CommercetoolsRestClient } from "../client/rest-client";
import {
  commercetoolsProviderFailureReason,
  isConcurrentModification,
} from "../client/versioned-write";
import {
  fromCommercetoolsAddressKey,
  toCommercetoolsAddressKey,
} from "./address-book-key";

const ACCESS_DENIED_STATUS_CODE = 403;
const NOT_FOUND_STATUS_CODE = 404;
const SERVER_ERROR_STATUS_CODE = 500;
const MAX_SAVE_RETRIES = 1;

export { toCommercetoolsAddressKey } from "./address-book-key";

const CommercetoolsError = Schema.Struct({
  code: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SDK transport rejections are decoded by the status-code schema at this boundary.
const decodeCommercetoolsError = (error: unknown) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(CommercetoolsError)(error));

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SDK transport rejections are decoded by the status-code schema at this boundary.
const errorStatusCode = (error: unknown) =>
  decodeCommercetoolsError(error)?.statusCode;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SDK transport rejections are decoded by the status-code schema at this boundary.
const isAccessDenied = (error: unknown) => {
  const statusCode = errorStatusCode(error);
  return (
    statusCode === ACCESS_DENIED_STATUS_CODE ||
    statusCode === NOT_FOUND_STATUS_CODE
  );
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SDK transport rejections are decoded by the status-code schema at this boundary.
const isAmbiguousWriteFailure = (error: unknown) => {
  const statusCode = errorStatusCode(error);
  return (
    isConcurrentModification(error) ||
    statusCode === undefined ||
    statusCode >= SERVER_ERROR_STATUS_CODE
  );
};

const accessDenied = (operation: AddressBookOperation) =>
  new AddressBookAccessDenied({
    message: "Buyer cannot access this Address Book",
    operation,
  });

const providerFailure = (
  operation: AddressBookOperation,
  cause: unknown,
  reason: ProviderFailureReason,
  message = `Failed to ${operation} Address Book`
) => new AddressBookProviderFailure({ cause, message, operation, reason });

const writeOutcomeUnknown = (reference: AddressBookReference, cause: unknown) =>
  new AddressBookWriteOutcomeUnknown({
    cause,
    message: "Could not confirm whether the Address Book entry changed",
    reference,
  });

type AddressOwner = BusinessUnit | Customer;
type AddressUpdateAction = BusinessUnitUpdateAction & CustomerUpdateAction;

const addressOwnerRequest = (
  apiRoot: ByProjectKeyRequestBuilder,
  principal: AuthenticatedCommercePrincipal
) =>
  principal._tag === "B2CPurchasingPrincipal"
    ? apiRoot.customers().withId({ ID: String(principal.customerId) })
    : apiRoot
        .asAssociate()
        .withAssociateIdValue({
          associateId: String(principal.customerId),
        })
        .businessUnits()
        .withKey({ key: String(principal.businessUnitKey) });

const readAddressOwner = (
  apiRoot: ByProjectKeyRequestBuilder,
  principal: AuthenticatedCommercePrincipal,
  operation: AddressBookOperation
) =>
  Effect.tryPromise({
    catch: (cause) =>
      isAccessDenied(cause)
        ? accessDenied(operation)
        : providerFailure(
            operation,
            cause,
            commercetoolsProviderFailureReason(cause)
          ),
    try: async () => {
      const response = await addressOwnerRequest(apiRoot, principal)
        .get()
        .execute();
      return response.body;
    },
  });

const addressTypes = (
  businessUnit: AddressOwner,
  addressId: string
): readonly AddressType[] => {
  const types: AddressType[] = [];

  if (businessUnit.shippingAddressIds?.includes(addressId)) {
    types.push("shipping");
  }
  if (businessUnit.billingAddressIds?.includes(addressId)) {
    types.push("billing");
  }

  return normalizeAddressTypes(types, {
    defaultBilling: businessUnit.defaultBillingAddressId === addressId,
    defaultShipping: businessUnit.defaultShippingAddressId === addressId,
  });
};

const toAddressBookEntry = (
  businessUnit: AddressOwner,
  address: CommercetoolsAddress,
  reference: AddressBookReference,
  operation: AddressBookOperation
) => {
  const types = address.id ? addressTypes(businessUnit, address.id) : [];

  return Schema.decodeUnknownEffect(AddressBookEntry)({
    address: {
      addressLine1: [address.streetNumber, address.streetName]
        .filter(Boolean)
        .join(" "),
      addressLine2: address.additionalStreetInfo,
      city: address.city ?? "",
      country: address.country,
      postalCode: address.postalCode ?? "",
      region: address.region ?? address.state,
    },
    defaultBilling: address.id === businessUnit.defaultBillingAddressId,
    defaultShipping: address.id === businessUnit.defaultShippingAddressId,
    reference,
    types,
  }).pipe(
    Effect.mapError((cause) =>
      providerFailure(
        operation,
        cause,
        "invalidData",
        "Account contains an invalid Address Book entry"
      )
    )
  );
};

const findAddress = (
  businessUnit: AddressOwner,
  reference: AddressBookReference
) =>
  businessUnit.addresses.find(
    (address) => address.key === toCommercetoolsAddressKey(reference)
  );

const hasAddressType = (
  businessUnit: AddressOwner,
  address: CommercetoolsAddress
) =>
  address.id !== undefined && addressTypes(businessUnit, address.id).length > 0;

const getEntry = (
  businessUnit: AddressOwner,
  reference: AddressBookReference,
  operation: AddressBookOperation
) =>
  Effect.gen(function* () {
    const address = findAddress(businessUnit, reference);

    if (!(address && hasAddressType(businessUnit, address))) {
      return yield* new AddressBookEntryNotFound({
        message: "Address Book entry does not exist",
        reference,
      });
    }

    return yield* toAddressBookEntry(
      businessUnit,
      address,
      reference,
      operation
    );
  });

const listEntries = (
  businessUnit: AddressOwner,
  operation: AddressBookOperation
) =>
  Effect.forEach(
    businessUnit.addresses,
    (address) => {
      const reference = address.key
        ? fromCommercetoolsAddressKey(address.key)
        : undefined;

      if (!(reference && hasAddressType(businessUnit, address))) {
        return Effect.succeed(undefined);
      }

      return toAddressBookEntry(
        businessUnit,
        address,
        reference,
        operation
      ).pipe(Effect.map((entry): AddressBookEntry | undefined => entry));
    },
    { concurrency: "unbounded" }
  ).pipe(
    Effect.map((entries) =>
      entries.filter((entry): entry is AddressBookEntry => entry !== undefined)
    )
  );

class CommercetoolsAddressBookWriteFailure {
  readonly _tag = "CommercetoolsAddressBookWriteFailure";
  readonly cause: unknown;

  constructor(cause: unknown) {
    this.cause = cause;
  }
}

const updateActions = (
  input: SaveAddressBookEntryInput
): AddressUpdateAction[] => {
  const addressKey = toCommercetoolsAddressKey(input.reference);
  const types = normalizeAddressTypes(input.types, input);
  const address = {
    key: addressKey,
    streetName: input.address.addressLine1,
    streetNumber: "",
    additionalStreetInfo: input.address.addressLine2,
    postalCode: input.address.postalCode,
    city: input.address.city,
    country: input.address.country,
    region: input.address.region,
  };
  const actions: AddressUpdateAction[] = [{ action: "addAddress", address }];

  if (types.includes("shipping")) {
    actions.push({ action: "addShippingAddressId", addressKey });
  }
  if (types.includes("billing")) {
    actions.push({ action: "addBillingAddressId", addressKey });
  }
  if (input.defaultShipping) {
    actions.push({ action: "setDefaultShippingAddress", addressKey });
  }
  if (input.defaultBilling) {
    actions.push({ action: "setDefaultBillingAddress", addressKey });
  }

  return actions;
};

const writeAddressOwner = (
  apiRoot: ByProjectKeyRequestBuilder,
  principal: AuthenticatedCommercePrincipal,
  businessUnit: AddressOwner,
  actions: readonly AddressUpdateAction[]
) =>
  Effect.tryPromise({
    catch: (cause) => new CommercetoolsAddressBookWriteFailure(cause),
    try: async () => {
      const response = await addressOwnerRequest(apiRoot, principal)
        .post({
          body: {
            actions: [...actions],
            version: businessUnit.version,
          },
        })
        .execute();
      return response.body;
    },
  });

const entryFromSuccessfulWrite = (
  businessUnit: AddressOwner,
  reference: AddressBookReference
) => {
  const saved = findAddress(businessUnit, reference);
  return saved
    ? toAddressBookEntry(businessUnit, saved, reference, "save")
    : Effect.fail(
        providerFailure(
          "save",
          businessUnit,
          "unexpectedResponse",
          "Commercetools did not return the saved Address Book entry"
        )
      );
};

const saveAbsentEntry = (
  apiRoot: ByProjectKeyRequestBuilder,
  principal: AuthenticatedCommercePrincipal,
  businessUnit: AddressOwner,
  input: SaveAddressBookEntryInput,
  retriesRemaining: number
): Effect.Effect<
  AddressBookEntry,
  | AddressBookAccessDenied
  | AddressBookProviderFailure
  | AddressBookWriteOutcomeUnknown
> =>
  Effect.gen(function* () {
    const writeResult = yield* Effect.result(
      writeAddressOwner(apiRoot, principal, businessUnit, updateActions(input))
    );

    if (writeResult._tag === "Success") {
      return yield* entryFromSuccessfulWrite(
        writeResult.success,
        input.reference
      );
    }

    const writeCause = writeResult.failure.cause;
    if (isAccessDenied(writeCause)) {
      return yield* accessDenied("save");
    }
    if (!isAmbiguousWriteFailure(writeCause)) {
      return yield* providerFailure(
        "save",
        writeCause,
        commercetoolsProviderFailureReason(writeCause)
      );
    }

    const reconciled = yield* readAddressOwner(apiRoot, principal, "save").pipe(
      Effect.mapError((reconciliationFailure) =>
        writeOutcomeUnknown(input.reference, reconciliationFailure)
      )
    );
    const existing = findAddress(reconciled, input.reference);

    if (existing) {
      return yield* toAddressBookEntry(
        reconciled,
        existing,
        input.reference,
        "save"
      );
    }

    if (retriesRemaining === 0) {
      return yield* providerFailure(
        "save",
        writeCause,
        commercetoolsProviderFailureReason(writeCause)
      );
    }

    return yield* saveAbsentEntry(
      apiRoot,
      principal,
      reconciled,
      input,
      retriesRemaining - 1
    );
  });

const addressBookImplementationLayer = Layer.effect(
  AddressBook,
  Effect.gen(function* () {
    const commerceContext = yield* CommerceContext;
    const authenticatedPrincipal = CommerceContext.customerPrincipal().pipe(
      Effect.provideService(CommerceContext, commerceContext)
    );
    const { apiRoot } = yield* CommercetoolsRestClient;

    return AddressBook.of({
      change: Effect.fn("CommercetoolsAddressBook.change")(
        function* (reference, change) {
          const principal = yield* authenticatedPrincipal;
          const { operation } = change;
          if (principal._tag !== "B2CPurchasingPrincipal") {
            return yield* accessDenied(operation);
          }
          const customer = yield* readAddressOwner(
            apiRoot,
            principal,
            operation
          );
          const previous = findAddress(customer, reference);
          if (!previous?.id || !hasAddressType(customer, previous)) {
            return yield* new AddressBookEntryNotFound({
              message: "Address Book entry does not exist",
              reference,
            });
          }
          const { id: addressId, ...previousFields } = previous;
          const actions: AddressUpdateAction[] = [];
          switch (operation) {
            case "edit": {
              const { address } = change;
              actions.push({
                action: "changeAddress",
                address: {
                  ...previousFields,
                  additionalStreetInfo: address.addressLine2,
                  city: address.city,
                  country: address.country,
                  postalCode: address.postalCode,
                  region: address.region,
                  state: undefined,
                  streetName: address.addressLine1,
                  streetNumber: "",
                },
                addressId,
              });
              break;
            }
            case "remove": {
              actions.push({ action: "removeAddress", addressId });
              break;
            }
            case "setDefault": {
              if (
                customer.defaultShippingAddressId === addressId &&
                customer.defaultBillingAddressId === addressId
              ) {
                return;
              }
              actions.push(
                { action: "setDefaultShippingAddress", addressId },
                { action: "setDefaultBillingAddress", addressId }
              );
              break;
            }
            default: {
              return operation satisfies never;
            }
          }
          const result = yield* Effect.result(
            writeAddressOwner(apiRoot, principal, customer, actions)
          );
          if (result._tag === "Success") {
            return;
          }
          const { cause } = result.failure;
          if (isAccessDenied(cause)) {
            return yield* accessDenied(operation);
          }
          if (isAmbiguousWriteFailure(cause)) {
            return yield* writeOutcomeUnknown(reference, cause);
          }
          if (errorStatusCode(cause) === 400) {
            return yield* Effect.fail(
              addressBookMutationRejected({
                message: "Commercetools rejected this address change",
                reference,
              })
            );
          }
          return yield* providerFailure(
            operation,
            cause,
            commercetoolsProviderFailureReason(cause)
          );
        }
      ),
      get: Effect.fn("CommercetoolsAddressBook.get")(function* (reference) {
        const principal = yield* authenticatedPrincipal;
        const businessUnit = yield* readAddressOwner(apiRoot, principal, "get");
        return yield* getEntry(businessUnit, reference, "get");
      }),
      list: Effect.fn("CommercetoolsAddressBook.list")(function* () {
        const principal = yield* authenticatedPrincipal;
        const businessUnit = yield* readAddressOwner(
          apiRoot,
          principal,
          "list"
        );
        return yield* listEntries(businessUnit, "list");
      }),
      save: Effect.fn("CommercetoolsAddressBook.save")(function* (input) {
        const principal = yield* authenticatedPrincipal;
        const current = yield* readAddressOwner(apiRoot, principal, "save");
        const existing = findAddress(current, input.reference);

        if (existing) {
          return yield* toAddressBookEntry(
            current,
            existing,
            input.reference,
            "save"
          );
        }

        return yield* saveAbsentEntry(
          apiRoot,
          principal,
          current,
          input,
          MAX_SAVE_RETRIES
        );
      }),
    });
  })
);

export const addressBookLayerFrom = (apiRoot: ByProjectKeyRequestBuilder) =>
  addressBookImplementationLayer.pipe(
    Layer.provide(CommercetoolsRestClient.testLayer(apiRoot))
  );

export const addressBookLayer = addressBookImplementationLayer.pipe(
  Layer.provide(commercetoolsClientsLayer)
);
