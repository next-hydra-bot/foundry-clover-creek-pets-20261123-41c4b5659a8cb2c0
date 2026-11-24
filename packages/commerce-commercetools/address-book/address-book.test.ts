import type {
  BusinessUnit,
  BusinessUnitUpdate,
  ByProjectKeyRequestBuilder,
} from "@commercetools/platform-sdk";
import { describe, expect, it } from "@effect/vitest";
import { CountryCode } from "@repo/commerce-core/domain/address";
import {
  AddressBookEntry,
  AddressBookEntryNotFound,
  AddressBookProviderFailure,
  AddressBookReference,
  AddressBookWriteOutcomeUnknown,
} from "@repo/commerce-core/domain/address-book";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  CustomerCommercePrincipal,
  B2CPurchasingPrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CommerceLocale, Store, StoreKey } from "@repo/commerce-core/store";
import { Effect, Layer } from "effect";
import { vi } from "vitest";

import {
  addressBookLayerFrom,
  toCommercetoolsAddressKey,
} from "./address-book";

const buyer = new CustomerCommercePrincipal({
  authUserId: AuthUserId.make("auth-user-1"),
  businessUnitId: CommerceBusinessUnitId.make("business-unit-1"),
  businessUnitKey: CommerceBusinessUnitKey.make("business-unit-key-1"),
  customerId: CommerceCustomerId.make("customer-1"),
  roles: ["admin", "buyer"],
});
const store = new Store({
  currency: "USD",
  locale: CommerceLocale.make("en-US"),
  storeKey: StoreKey.make("default-store"),
});

const commerceContext = Layer.succeed(
  CommerceContext,
  CommerceContext.of({
    customerPrincipal: () => Effect.succeed(buyer),
    customerProfile: () =>
      Effect.die("Address Book does not read the customer profile"),
    principal: buyer,
    store,
  })
);

const addressBookLayerFor = (apiRoot: ByProjectKeyRequestBuilder) =>
  addressBookLayerFrom(apiRoot).pipe(Layer.provide(commerceContext));

const address = {
  addressLine1: "100 Main Street",
  addressLine2: "Suite 200",
  city: "New York",
  country: CountryCode.make("US"),
  postalCode: "10001",
  region: "NY",
};

const reference = AddressBookReference.make("office");

const businessUnit = (overrides: Partial<BusinessUnit> = {}): BusinessUnit =>
  // SAFETY: Test fixture supplies only the BusinessUnit fields this suite reads.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Platform BusinessUnit is not constructible in unit tests.
  ({
    addresses: [
      {
        additionalStreetInfo: address.addressLine2,
        city: address.city,
        country: address.country,
        id: "address-1",
        key: toCommercetoolsAddressKey(reference),
        postalCode: address.postalCode,
        region: address.region,
        streetName: address.addressLine1,
        streetNumber: "",
      },
    ],
    billingAddressIds: ["address-1"],
    defaultBillingAddressId: "address-1",
    defaultShippingAddressId: "address-1",
    id: "business-unit-1",
    key: "business-unit-key-1",
    shippingAddressIds: ["address-1"],
    version: 3,
    ...overrides,
  }) as BusinessUnit;

const apiRootForBusinessUnit = () => {
  const getExecute = vi.fn<() => Promise<{ body: BusinessUnit }>>();
  const postExecute = vi.fn<() => Promise<{ body: BusinessUnit }>>();
  const get = vi.fn<() => { execute: typeof getExecute }>(() => ({
    execute: getExecute,
  }));
  const post = vi.fn<
    (_request: { readonly body: BusinessUnitUpdate }) => {
      execute: typeof postExecute;
    }
  >((_request) => ({
    execute: postExecute,
  }));
  const withKey = vi.fn<() => { get: typeof get; post: typeof post }>(() => ({
    get,
    post,
  }));
  const businessUnits = vi.fn<() => { withKey: typeof withKey }>(() => ({
    withKey,
  }));
  const withAssociateIdValue = vi.fn<
    () => { businessUnits: typeof businessUnits }
  >(() => ({ businessUnits }));
  const asAssociate = vi.fn<
    () => { withAssociateIdValue: typeof withAssociateIdValue }
  >(() => ({ withAssociateIdValue }));
  // SAFETY: Test fixture supplies only the ByProjectKeyRequestBuilder fields this suite reads.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- Platform ByProjectKeyRequestBuilder is not constructible in unit tests.
  const apiRoot = { asAssociate } as unknown as ByProjectKeyRequestBuilder;

  return {
    apiRoot,
    asAssociate,
    businessUnits,
    get,
    getExecute,
    post,
    postExecute,
    withAssociateIdValue,
    withKey,
  };
};

describe("addressBookLayer", () => {
  it.effect(
    "reads incomplete company addresses without failing the Address Book",
    () => {
      const api = apiRootForBusinessUnit();
      api.getExecute.mockResolvedValueOnce({
        body: businessUnit({
          addresses: [
            {
              id: "address-1",
              key: toCommercetoolsAddressKey(reference),
              country: "US",
              state: "NY",
            },
          ],
        }),
      });
      return Effect.gen(function* () {
        const entries = yield* AddressBook.list();
        expect(entries[0]).toMatchObject({
          reference,
          defaultShipping: true,
          address: {
            addressLine1: "",
            city: "",
            postalCode: "",
            country: "US",
            region: "NY",
          },
        });
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );

  it.effect(
    "lists canonical entries through the verified associate scope",
    () =>
      Effect.gen(function* () {
        const api = apiRootForBusinessUnit();
        api.getExecute.mockResolvedValueOnce({
          body: businessUnit({
            billingAddressIds: [],
            shippingAddressIds: [],
          }),
        });

        return yield* Effect.gen(function* () {
          const addressBook = yield* AddressBook;
          const entries = yield* addressBook.list();

          expect(entries).toStrictEqual([
            new AddressBookEntry({
              address,
              defaultBilling: true,
              defaultShipping: true,
              reference: AddressBookReference.make("office"),
              types: ["shipping", "billing"],
            }),
          ]);
          expect(api.withAssociateIdValue).toHaveBeenCalledWith({
            associateId: "customer-1",
          });
          expect(api.withKey).toHaveBeenCalledWith({
            key: "business-unit-key-1",
          });
        }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
      })
  );

  it.effect(
    "returns the existing canonical entry without another write",
    () => {
      const api = apiRootForBusinessUnit();
      api.getExecute.mockResolvedValueOnce({ body: businessUnit() });

      return Effect.gen(function* () {
        const addressBook = yield* AddressBook;
        const saved = yield* addressBook.save({
          address: { ...address, addressLine1: "Different submission" },
          defaultBilling: false,
          defaultShipping: false,
          reference,
          types: ["billing"],
        });

        expect(saved.address.addressLine1).toBe("100 Main Street");
        expect(saved.types).toStrictEqual(["shipping", "billing"]);
        expect(api.post).not.toHaveBeenCalled();
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );

  it.effect(
    "adds an address and requested markers in one versioned update",
    () => {
      const api = apiRootForBusinessUnit();
      api.getExecute.mockResolvedValueOnce({
        body: businessUnit({
          addresses: [],
          billingAddressIds: [],
          defaultBillingAddressId: undefined,
          defaultShippingAddressId: undefined,
          shippingAddressIds: [],
        }),
      });
      api.postExecute.mockResolvedValueOnce({ body: businessUnit() });

      return Effect.gen(function* () {
        const addressBook = yield* AddressBook;
        const saved = yield* addressBook.save({
          address,
          defaultBilling: true,
          defaultShipping: true,
          reference,
          types: ["billing"],
        });

        expect(saved.reference).toBe(reference);
        expect(api.post).toHaveBeenCalledWith({
          body: {
            actions: [
              {
                action: "addAddress",
                address: {
                  additionalStreetInfo: address.addressLine2,
                  city: address.city,
                  country: address.country,
                  key: toCommercetoolsAddressKey(reference),
                  postalCode: address.postalCode,
                  region: address.region,
                  streetName: address.addressLine1,
                  streetNumber: "",
                },
              },
              {
                action: "addShippingAddressId",
                addressKey: toCommercetoolsAddressKey(reference),
              },
              {
                action: "addBillingAddressId",
                addressKey: toCommercetoolsAddressKey(reference),
              },
              {
                action: "setDefaultShippingAddress",
                addressKey: toCommercetoolsAddressKey(reference),
              },
              {
                action: "setDefaultBillingAddress",
                addressKey: toCommercetoolsAddressKey(reference),
              },
            ],
            version: 3,
          },
        });
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );

  it.effect("returns a typed not-found error for an absent reference", () => {
    const api = apiRootForBusinessUnit();
    api.getExecute.mockResolvedValueOnce({
      body: businessUnit({ addresses: [] }),
    });

    return Effect.gen(function* () {
      const addressBook = yield* AddressBook;
      const error = yield* addressBook.get(reference).pipe(Effect.flip);

      expect(error).toBeInstanceOf(AddressBookEntryNotFound);
    }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
  });

  it.effect(
    "keeps keyed addresses without an Address Type outside the catalog",
    () => {
      const api = apiRootForBusinessUnit();
      const untypedReference = AddressBookReference.make("untyped");
      const current = businessUnit();
      const [firstAddress] = current.addresses;
      if (!firstAddress) {
        throw new Error("Business Unit fixture requires an address");
      }
      const untypedAddress = {
        ...firstAddress,
        id: "address-2",
        key: toCommercetoolsAddressKey(untypedReference),
      };
      const withUntypedAddress = businessUnit({
        addresses: [...current.addresses, untypedAddress],
      });
      api.getExecute
        .mockResolvedValueOnce({ body: withUntypedAddress })
        .mockResolvedValueOnce({ body: withUntypedAddress });

      return Effect.gen(function* () {
        const addressBook = yield* AddressBook;

        expect(yield* addressBook.list()).toHaveLength(1);
        const error = yield* addressBook
          .get(untypedReference)
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(AddressBookEntryNotFound);
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );

  it.effect("preserves associate access denial as a typed error", () => {
    const api = apiRootForBusinessUnit();
    api.getExecute.mockRejectedValueOnce({
      code: "AssociateMissingPermission",
      statusCode: 403,
    });

    return Effect.gen(function* () {
      const addressBook = yield* AddressBook;
      const error = yield* addressBook.list().pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "AddressBookAccessDenied",
        operation: "list",
      });
    }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
  });

  it.effect("classifies provider outages as recoverable", () => {
    const api = apiRootForBusinessUnit();
    api.getExecute.mockRejectedValueOnce({ statusCode: 503 });

    return Effect.gen(function* () {
      const addressBook = yield* AddressBook;
      const error = yield* addressBook.list().pipe(Effect.flip);

      expect(error).toBeInstanceOf(AddressBookProviderFailure);
      expect(error).toMatchObject({
        operation: "list",
        reason: "unavailable",
      });
    }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
  });

  it.effect("classifies provider rate limits as recoverable", () => {
    const api = apiRootForBusinessUnit();
    api.getExecute.mockRejectedValueOnce({ statusCode: 429 });

    return Effect.gen(function* () {
      const addressBook = yield* AddressBook;
      const error = yield* addressBook.list().pipe(Effect.flip);

      expect(error).toBeInstanceOf(AddressBookProviderFailure);
      expect(error).toMatchObject({
        operation: "list",
        reason: "unavailable",
      });
    }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
  });

  it.effect(
    "classifies invalid provider address data as a defect candidate",
    () => {
      const api = apiRootForBusinessUnit();
      const invalidAddress = businessUnit();
      const [firstAddress] = invalidAddress.addresses;
      if (firstAddress === undefined) {
        throw new Error("Business Unit fixture requires an address");
      }
      api.getExecute.mockResolvedValueOnce({
        body: businessUnit({
          addresses: [{ ...firstAddress, country: "ZZ" }],
        }),
      });

      return Effect.gen(function* () {
        const addressBook = yield* AddressBook;
        const error = yield* addressBook.list().pipe(Effect.flip);

        expect(error).toBeInstanceOf(AddressBookProviderFailure);
        expect(error).toMatchObject({
          operation: "list",
          reason: "invalidData",
        });
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );

  it.effect(
    "recovers an entry that exists after an ambiguous write failure",
    () => {
      const api = apiRootForBusinessUnit();
      api.getExecute
        .mockResolvedValueOnce({
          body: businessUnit({
            addresses: [],
            billingAddressIds: [],
            defaultBillingAddressId: undefined,
            defaultShippingAddressId: undefined,
            shippingAddressIds: [],
          }),
        })
        .mockResolvedValueOnce({ body: businessUnit() });
      api.postExecute.mockRejectedValueOnce({ statusCode: 503 });

      return Effect.gen(function* () {
        const addressBook = yield* AddressBook;
        const saved = yield* addressBook.save({
          address,
          defaultBilling: true,
          defaultShipping: true,
          reference,
          types: ["shipping", "billing"],
        });

        expect(saved.reference).toBe(reference);
        expect(api.post).toHaveBeenCalledOnce();
        expect(api.get).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );

  it.effect(
    "retries once when reconciliation confirms the entry is absent",
    () => {
      const api = apiRootForBusinessUnit();
      const withoutAddresses = businessUnit({
        addresses: [],
        billingAddressIds: [],
        defaultBillingAddressId: undefined,
        defaultShippingAddressId: undefined,
        shippingAddressIds: [],
        version: 3,
      });
      api.getExecute
        .mockResolvedValueOnce({ body: withoutAddresses })
        .mockResolvedValueOnce({
          body: businessUnit({ ...withoutAddresses, version: 4 }),
        });
      api.postExecute
        .mockRejectedValueOnce({ statusCode: 409 })
        .mockResolvedValueOnce({ body: businessUnit({ version: 5 }) });

      return Effect.gen(function* () {
        const addressBook = yield* AddressBook;
        const saved = yield* addressBook.save({
          address,
          defaultBilling: false,
          defaultShipping: false,
          reference,
          types: ["shipping"],
        });

        expect(saved.reference).toBe(reference);
        expect(api.post).toHaveBeenCalledTimes(2);
        expect(api.get).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );

  it.effect(
    "preserves the reference when an ambiguous write cannot be reconciled",
    () => {
      const api = apiRootForBusinessUnit();
      api.getExecute
        .mockResolvedValueOnce({
          body: businessUnit({
            addresses: [],
            billingAddressIds: [],
            defaultBillingAddressId: undefined,
            defaultShippingAddressId: undefined,
            shippingAddressIds: [],
          }),
        })
        .mockRejectedValueOnce({ statusCode: 503 });
      api.postExecute.mockRejectedValueOnce({ statusCode: 503 });

      return Effect.gen(function* () {
        const addressBook = yield* AddressBook;
        const error = yield* addressBook
          .save({
            address,
            defaultBilling: false,
            defaultShipping: false,
            reference,
            types: ["shipping"],
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(AddressBookWriteOutcomeUnknown);
        expect(error).toMatchObject({ reference });
      }).pipe(Effect.provide(addressBookLayerFor(api.apiRoot)));
    }
  );
});

describe("personal Customer Address Book", () => {
  const personal = new B2CPurchasingPrincipal({
    authUserId: buyer.authUserId,
    customerId: buyer.customerId,
  });
  const b2cContext = Layer.succeed(
    CommerceContext,
    CommerceContext.of({
      customerPrincipal: () => Effect.succeed(personal),
      customerProfile: () => Effect.die("not used"),
      principal: personal,
      store,
    })
  );
  const b2cApi = () => {
    const api = apiRootForBusinessUnit();
    const withId = vi.fn<
      (...args: unknown[]) => { get: typeof api.get; post: typeof api.post }
    >(() => ({ get: api.get, post: api.post }));
    // SAFETY: The request double exposes the Customer methods exercised by this provider.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- Platform request builders are not constructible test fixtures.
    const root = {
      asAssociate: api.asAssociate,
      customers: () => ({ withId }),
    } as unknown as ByProjectKeyRequestBuilder;
    return { ...api, root, withId };
  };

  it.effect(
    "reads a Customer address without optional city or postal code",
    () => {
      const api = b2cApi();
      api.getExecute.mockResolvedValueOnce({
        body: businessUnit({
          addresses: [
            {
              id: "address-1",
              key: toCommercetoolsAddressKey(reference),
              country: "HK",
              streetName: "20 Harbour Road",
            },
          ],
        }),
      });
      return Effect.gen(function* () {
        const entries = yield* AddressBook.list();
        expect(entries[0]?.address).toMatchObject({
          addressLine1: "20 Harbour Road",
          city: "",
          postalCode: "",
          country: "HK",
        });
      }).pipe(
        Effect.provide(
          addressBookLayerFrom(api.root).pipe(Layer.provide(b2cContext))
        )
      );
    }
  );

  it.effect(
    "reads addresses by verified Customer id without an associate request",
    () =>
      Effect.gen(function* () {
        const api = b2cApi();
        api.getExecute.mockResolvedValueOnce({ body: businessUnit() });
        const entries = yield* AddressBook.list().pipe(
          Effect.provide(
            addressBookLayerFrom(api.root).pipe(Layer.provide(b2cContext))
          )
        );
        expect(entries).toHaveLength(1);
        expect(api.withId).toHaveBeenCalledWith({ ID: buyer.customerId });
        expect(api.asAssociate).not.toHaveBeenCalled();
      })
  );

  it.effect(
    "saves Customer addresses with the same canonical references and address types",
    () =>
      Effect.gen(function* () {
        const api = b2cApi();
        api.getExecute.mockResolvedValueOnce({
          body: businessUnit({ addresses: [] }),
        });
        api.postExecute.mockResolvedValueOnce({ body: businessUnit() });
        const saved = yield* AddressBook.save({
          address,
          defaultBilling: false,
          defaultShipping: false,
          reference,
          types: ["shipping", "billing"],
        }).pipe(
          Effect.provide(
            addressBookLayerFrom(api.root).pipe(Layer.provide(b2cContext))
          )
        );
        expect(saved.reference).toBe(reference);
        expect(api.post).toHaveBeenCalledWith({
          body: {
            actions: [
              {
                action: "addAddress",
                address: {
                  key: toCommercetoolsAddressKey(reference),
                  country: "US",
                  streetName: address.addressLine1,
                  streetNumber: "",
                  additionalStreetInfo: address.addressLine2,
                  postalCode: address.postalCode,
                  city: address.city,
                  region: address.region,
                },
              },
              {
                action: "addShippingAddressId",
                addressKey: toCommercetoolsAddressKey(reference),
              },
              {
                action: "addBillingAddressId",
                addressKey: toCommercetoolsAddressKey(reference),
              },
            ],
            version: 3,
          },
        });
        expect(api.asAssociate).not.toHaveBeenCalled();
      })
  );
});
