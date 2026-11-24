import type {
  Address as NativeAddress,
  BusinessUnit,
  BusinessUnitUpdateAction,
  ByProjectKeyRequestBuilder,
} from "@commercetools/platform-sdk";
import { Address } from "@repo/commerce-core/domain/address";
import { CommerceBusinessUnitId } from "@repo/commerce-core/domain/commerce-account";
import type { CustomerCommercePrincipal } from "@repo/commerce-core/domain/commerce-request-context";
import {
  CompanyProfile,
  CompanyProfileRevision,
  CompanyProfileChanged,
  CompanyProfileUnavailable,
  CompanyProfileWriteOutcomeUnknown,
} from "@repo/commerce-core/domain/company-profile";
import { CompanyProfiles } from "@repo/commerce-core/services/company-profiles";
import { Effect, Layer, Schema } from "effect";

import { commercetoolsRestClientLayer } from "../client/layers";
import { CommercetoolsRestClient } from "../client/rest-client";

const fromAddress = (address: NativeAddress) =>
  Schema.decodeUnknownEffect(Address)({
    addressLine1: [address.streetNumber, address.streetName]
      .filter(Boolean)
      .join(" "),
    addressLine2: address.additionalStreetInfo,
    city: address.city ?? "",
    country: address.country,
    postalCode: address.postalCode ?? "",
    region: address.region,
  });
const project = (unit: BusinessUnit) =>
  Effect.gen(function* () {
    const shipping = unit.addresses.find(
      ({ id }) => id === unit.defaultShippingAddressId
    );
    const billing = unit.addresses.find(
      ({ id }) => id === unit.defaultBillingAddressId
    );
    return new CompanyProfile({
      billingAddress: billing ? yield* fromAddress(billing) : undefined,
      businessUnitId: CommerceBusinessUnitId.make(unit.id),
      companyName: unit.name,
      name: unit.name,
      phone: shipping?.phone,
      revision: CompanyProfileRevision.make(`${unit.id}:${unit.version}`),
      shippingAddress: shipping ? yield* fromAddress(shipping) : undefined,
    });
  }).pipe(
    Effect.mapError(
      () =>
        new CompanyProfileUnavailable({
          message: "Company addresses could not be read.",
        })
    )
  );
const status = (cause: unknown) =>
  Schema.decodeUnknownOption(Schema.Struct({ statusCode: Schema.Finite }))(
    cause
  );

const request = (
  api: ByProjectKeyRequestBuilder,
  principal: CustomerCommercePrincipal
) =>
  api
    .asAssociate()
    .withAssociateIdValue({ associateId: principal.customerId })
    .businessUnits()
    .withKey({ key: principal.businessUnitKey });

export const companyProfilesLayerFrom = (api: ByProjectKeyRequestBuilder) =>
  Layer.succeed(
    CompanyProfiles,
    CompanyProfiles.of({
      get: (principal) =>
        Effect.tryPromise({
          catch: () =>
            new CompanyProfileUnavailable({
              message: "Company details could not be read.",
            }),
          try: async () => {
            const response = await request(api, principal).get().execute();
            return response.body;
          },
        }).pipe(
          Effect.flatMap((unit) =>
            unit.id === principal.businessUnitId
              ? project(unit)
              : Effect.fail(
                  new CompanyProfileUnavailable({
                    message:
                      "Company details do not match the selected company.",
                  })
                )
          )
        ),
      save: (principal, input) =>
        Effect.gen(function* () {
          const unit = yield* Effect.tryPromise({
            catch: () =>
              new CompanyProfileUnavailable({
                message: "Company details could not be read.",
              }),
            try: async () => {
              const response = await request(api, principal).get().execute();
              return response.body;
            },
          });
          if (unit.id !== principal.businessUnitId) {
            return yield* new CompanyProfileUnavailable({
              message: "Company details do not match the selected company.",
            });
          }
          if (`${unit.id}:${unit.version}` !== input.revision) {
            return yield* new CompanyProfileChanged({
              message:
                "Company details changed. Refresh before saving your changes.",
            });
          }
          const actions: BusinessUnitUpdateAction[] = [
            { action: "changeName", name: input.name },
          ];
          const shared =
            unit.defaultShippingAddressId !== undefined &&
            unit.defaultShippingAddressId === unit.defaultBillingAddressId;
          const sameAddresses = (
            [
              "addressLine1",
              "addressLine2",
              "city",
              "country",
              "postalCode",
              "region",
            ] as const
          ).every(
            (field) =>
              input.shippingAddress[field] === input.billingAddress[field]
          );
          const upsert = (
            kind: "shipping" | "billing",
            address: Address,
            nativeId: string | undefined
          ) => {
            const existing = unit.addresses.find(({ id }) => id === nativeId);
            const key = `company-profile-${kind}-${unit.version}`;
            const reference = existing?.id
              ? { addressId: existing.id }
              : { addressKey: key };
            const prior = existing;
            const { id: _nativeId, ...previous } = prior ?? {};
            const value = {
              ...previous,
              additionalStreetInfo: address.addressLine2 ?? "",
              city: address.city,
              country: address.country,
              key: prior?.key ?? key,
              phone: input.phone,
              postalCode: address.postalCode,
              region: address.region ?? "",
              streetName: address.addressLine1,
              streetNumber: "",
            };
            actions.push(
              prior
                ? { action: "changeAddress", ...reference, address: value }
                : { action: "addAddress", address: value }
            );
            const addressIds =
              kind === "shipping"
                ? unit.shippingAddressIds
                : unit.billingAddressIds;
            if (!existing?.id || !addressIds?.includes(existing.id)) {
              actions.push(
                kind === "shipping"
                  ? { action: "addShippingAddressId", ...reference }
                  : { action: "addBillingAddressId", ...reference }
              );
            }
            actions.push(
              kind === "shipping"
                ? { action: "setDefaultShippingAddress", ...reference }
                : { action: "setDefaultBillingAddress", ...reference }
            );
          };
          upsert(
            "shipping",
            input.shippingAddress,
            unit.defaultShippingAddressId
          );
          if (shared && sameAddresses) {
            if (
              !unit.billingAddressIds?.includes(unit.defaultShippingAddressId)
            ) {
              actions.push({
                action: "addBillingAddressId",
                addressId: unit.defaultShippingAddressId,
              });
            }
            actions.push({
              action: "setDefaultBillingAddress",
              addressId: unit.defaultShippingAddressId,
            });
          } else {
            upsert(
              "billing",
              input.billingAddress,
              shared ? undefined : unit.defaultBillingAddressId
            );
          }
          const saved = yield* Effect.tryPromise({
            catch: (cause) => {
              const decoded = status(cause);
              if (decoded._tag === "Some" && decoded.value.statusCode === 409) {
                return new CompanyProfileChanged({
                  message:
                    "Company details changed. Refresh before saving your changes.",
                });
              }
              if (
                decoded._tag === "Some" &&
                decoded.value.statusCode >= 400 &&
                decoded.value.statusCode < 500
              ) {
                return new CompanyProfileUnavailable({
                  message:
                    "Company details were rejected. Check your permissions and address details.",
                });
              }
              return new CompanyProfileWriteOutcomeUnknown({
                message:
                  "The save could not be confirmed. Refresh company details before trying again.",
              });
            },
            try: async () => {
              const response = await request(api, principal)
                .post({ body: { actions, version: unit.version } })
                .execute();
              return response.body;
            },
          });
          if (saved.id !== principal.businessUnitId) {
            return yield* new CompanyProfileWriteOutcomeUnknown({
              message:
                "The saved company could not be confirmed. Refresh company details.",
            });
          }
          return yield* project(saved).pipe(
            Effect.mapError(
              () =>
                new CompanyProfileWriteOutcomeUnknown({
                  message:
                    "The saved company details could not be read. Refresh before trying again.",
                })
            )
          );
        }),
    })
  );

export const companyProfilesLayer = Layer.unwrap(
  CommercetoolsRestClient.pipe(
    Effect.map(({ apiRoot }) => companyProfilesLayerFrom(apiRoot))
  )
).pipe(Layer.provide(commercetoolsRestClientLayer));
