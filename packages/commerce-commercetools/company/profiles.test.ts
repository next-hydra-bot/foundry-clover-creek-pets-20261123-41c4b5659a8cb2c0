import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/ts-client";
import { describe, expect, it } from "@effect/vitest";
import { CountryCode } from "@repo/commerce-core/domain/address";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  CustomerCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { CompanyProfiles } from "@repo/commerce-core/services/company-profiles";
import { Effect, Schema } from "effect";

import { companyProfilesLayerFrom } from "./profiles";

const principal = new CustomerCommercePrincipal({
  authUserId: AuthUserId.make("user-1"),
  businessUnitId: CommerceBusinessUnitId.make("company-1"),
  businessUnitKey: CommerceBusinessUnitKey.make("company-one"),
  customerId: CommerceCustomerId.make("customer-1"),
  roles: ["buyer"],
});
const address = {
  addressLine1: "1 Main Street",
  city: "London",
  country: CountryCode.make("GB"),
  postalCode: "SW1A 1AA",
};
const fixture = () => {
  const DraftAddress = Schema.Struct({
    additionalStreetInfo: Schema.optional(Schema.String),
    city: Schema.String,
    country: Schema.String,
    firstName: Schema.optional(Schema.String),
    key: Schema.String,
    phone: Schema.String,
    postalCode: Schema.String,
    region: Schema.optional(Schema.String),
    streetName: Schema.String,
    streetNumber: Schema.optional(Schema.String),
  });
  const Reference = {
    addressId: Schema.optional(Schema.String),
    addressKey: Schema.optional(Schema.String),
  };
  const Update = Schema.Struct({
    actions: Schema.Array(
      Schema.Union([
        Schema.Struct({
          action: Schema.Literal("changeName"),
          name: Schema.String,
        }),
        Schema.Struct({
          action: Schema.Literal("changeAddress"),
          address: DraftAddress,
          ...Reference,
        }),
        Schema.Struct({
          action: Schema.Literal("addAddress"),
          address: DraftAddress,
        }),
        Schema.Struct({
          action: Schema.Literals([
            "addShippingAddressId",
            "addBillingAddressId",
            "setDefaultShippingAddress",
            "setDefaultBillingAddress",
          ]),
          ...Reference,
        }),
      ])
    ),
    version: Schema.Finite,
  });
  type StoredAddress = typeof DraftAddress.Type & { readonly id: string };
  const addresses: StoredAddress[] = [
    {
      city: "London",
      country: "GB",
      firstName: "Contact",
      id: "shared",
      key: "company-profile-billing",
      phone: "",
      postalCode: "SW1A 1AA",
      streetName: "1 Main Street",
    },
    {
      city: "London",
      country: "GB",
      firstName: "Other",
      id: "other",
      key: "unrelated",
      phone: "",
      postalCode: "SW1A 1AA",
      streetName: "Other address",
    },
  ];
  let unit = {
    addresses,
    billingAddressIds: ["shared"],
    defaultBillingAddressId: "shared",
    defaultShippingAddressId: "shared",
    id: "company-1",
    key: "company-one",
    name: "Equipment",
    shippingAddressIds: ["shared", "other"],
    unitType: "Company",
    version: 1,
  };
  const urls: string[] = [];
  let writes = 0;
  let lose = false;
  let conflict = false;
  let corruptResponse = false;
  const fetchApi: typeof fetch = async (url, init) => {
    const { url: href } = new Request(url);
    urls.push(href);
    if (init?.method === "POST") {
      if (conflict) {
        return await Promise.resolve(
          Response.json(
            {
              errors: [{ code: "ConcurrentModification" }],
              message: "Changed",
            },
            { status: 409 }
          )
        );
      }
      const bodyText = Schema.decodeUnknownSync(Schema.String)(init.body);
      const { actions, version } = Schema.decodeSync(
        Schema.fromJsonString(Update)
      )(bodyText);
      expect(version).toBe(unit.version);
      writes += 1;
      for (const action of actions) {
        const existing = unit.addresses.find(
          (candidate) =>
            ("addressId" in action && candidate.id === action.addressId) ||
            ("addressKey" in action && candidate.key === action.addressKey)
        );
        if (action.action === "changeName") {
          unit.name = action.name;
        }
        if (action.action === "changeAddress" && existing) {
          Object.assign(existing, action.address);
        }
        if (action.action === "addAddress") {
          unit.addresses.push({
            ...action.address,
            id: `address-${unit.addresses.length}`,
          });
        }
        if (action.action === "setDefaultShippingAddress") {
          unit.defaultShippingAddressId = existing?.id ?? "";
        }
        if (action.action === "setDefaultBillingAddress") {
          unit.defaultBillingAddressId = existing?.id ?? "";
        }
      }
      unit = { ...unit, version: unit.version + 1 };
      if (lose) {
        throw new Error("Response lost");
      }
    }
    return await Promise.resolve(
      Response.json(
        corruptResponse && init?.method === "POST"
          ? {
              ...unit,
              addresses: unit.addresses.map((address) => ({
                ...address,
                country: "invalid",
              })),
            }
          : unit
      )
    );
  };
  const client = new ClientBuilder()
    .withProjectKey("test")
    .withHttpMiddleware({
      enableRetry: false,
      host: "https://ct.example",
      httpClient: fetchApi,
    })
    .build();
  const api = createApiBuilderFromCtpClient(client).withProjectKey({
    projectKey: "test",
  });
  return {
    conflict: () => {
      conflict = true;
    },
    corrupt: () => {
      corruptResponse = true;
    },
    layer: companyProfilesLayerFrom(api),
    lose: () => {
      lose = true;
    },
    unit: () => unit,
    urls,
    writes: () => writes,
  };
};

describe("Commercetools company profiles", () => {
  it.effect(
    "splits a shared default address when billing changes and preserves unrelated addresses and contact fields",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* Effect.gen(function* () {
          const profiles = yield* CompanyProfiles;
          const current = yield* profiles.get(principal);
          const saved = yield* profiles.save(principal, {
            billingAddress: { ...address, addressLine1: "2 Billing Road" },
            name: "New name",
            phone: "+442012345678",
            revision: current.revision,
            shippingAddress: address,
          });
          expect([
            saved.shippingAddress?.addressLine1,
            saved.billingAddress?.addressLine1,
          ]).toEqual(["1 Main Street", "2 Billing Road"]);
          expect(
            source.unit().addresses.find(({ id }) => id === "other")?.streetName
          ).toBe("Other address");
          expect(
            source.unit().addresses.find(({ id }) => id === "shared")?.firstName
          ).toBe("Contact");
          expect(
            source.urls.every((url) =>
              url.includes(
                "as-associate/customer-1/business-units/key=company-one"
              )
            )
          ).toBeTruthy();
        }).pipe(Effect.provide(source.layer));
      })
  );
  it.effect(
    "reports a native version conflict and an uncertain committed save without replaying it",
    () =>
      Effect.gen(function* () {
        for (const mode of ["conflict", "lose"] as const) {
          const source = fixture();
          yield* Effect.gen(function* () {
            const profiles = yield* CompanyProfiles;
            const current = yield* profiles.get(principal);
            source[mode]();
            const failure = yield* profiles
              .save(principal, {
                billingAddress: address,
                name: "Saved",
                phone: "",
                revision: current.revision,
                shippingAddress: address,
              })
              .pipe(Effect.flip);
            expect(failure._tag).toBe(
              mode === "conflict"
                ? "CompanyProfileChanged"
                : "CompanyProfileWriteOutcomeUnknown"
            );
            expect(source.writes()).toBe(mode === "conflict" ? 0 : 1);
          }).pipe(Effect.provide(source.layer));
        }
      })
  );
});

it.effect(
  "retains outcome unknown when a committed response cannot be decoded",
  () =>
    Effect.gen(function* () {
      const source = fixture();
      yield* Effect.gen(function* () {
        const profiles = yield* CompanyProfiles;
        const current = yield* profiles.get(principal);
        source.corrupt();
        const error = yield* profiles
          .save(principal, {
            billingAddress: address,
            name: "Committed",
            phone: "",
            revision: current.revision,
            shippingAddress: address,
          })
          .pipe(Effect.flip);
        expect(error._tag).toBe("CompanyProfileWriteOutcomeUnknown");
        expect(source.writes()).toBe(1);
      }).pipe(Effect.provide(source.layer));
    })
);
