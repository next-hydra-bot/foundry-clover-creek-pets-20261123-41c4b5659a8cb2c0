import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/ts-client";
import { describe, expect, it } from "@effect/vitest";
import {
  CommerceAccount,
  CommerceBusinessUnitId,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import { CompanyPurchasingPolicyKey } from "@repo/commerce-core/domain/company-purchasing-policy";
import { CompanyPurchasingPolicies } from "@repo/commerce-core/services/company-purchasing-policies";
import { CommerceLocale, StoreKey } from "@repo/commerce-core/store";
import { Effect, Schema } from "effect";

import { companyPurchasingPoliciesLayerFrom } from "./purchasing-policies";

const policy = {
  currency: "USD",
  customerGroupId: "gold-id",
  key: CompanyPurchasingPolicyKey.make("gold"),
  label: "Gold",
  locale: CommerceLocale.make("en-US"),
  pricingGroupKey: "gold",
  storeKey: StoreKey.make("default-store"),
};
const account = new CommerceAccount({
  businessUnitId: CommerceBusinessUnitId.make("company-1"),
  customerId: CommerceCustomerId.make("customer-1"),
  registrationId: "registration-1",
});
const Resource = Schema.Record(Schema.String, Schema.Json);
const text = Schema.decodeUnknownSync(Schema.String);
type UnitFixture = {
  id: string;
  version: number;
  storeMode: string;
  stores: { key: string; typeId: string }[];
  customerGroupAssignments: { customerGroup: { id: string } }[] | null;
};
const fixture = (bindings = [policy]) => {
  const units = new Map<string, UnitFixture>(
    ["company-1", "company-2"].map((id) => [
      id,
      {
        customerGroupAssignments: null,
        id,
        storeMode: "Explicit",
        stores: [{ key: "other-store", typeId: "store" }],
        version: 1,
      },
    ])
  );
  let wrong = false;
  let lose = false;
  let writes = 0;
  let reads = 0;
  const fetchApi: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    if (pathname.includes("/customer-groups/")) {
      reads += 1;
      return Response.json({
        id: wrong ? "wrong" : pathname.split("/").at(-1),
      });
    }
    if (pathname.includes("/stores/")) {
      reads += 1;
      return Response.json({
        distributionChannels: [{ id: "sales" }],
        key: policy.storeKey,
        supplyChannels: [],
      });
    }
    if (pathname.endsWith("/graphql")) {
      const body = Schema.decodeUnknownSync(Resource)(await request.json());
      const variables = Schema.decodeUnknownSync(Resource)(body.variables);
      const unit = units.get(text(variables.id));
      if (!unit) {
        throw new Error("Missing unit");
      }
      if (text(body.query).includes("mutation")) {
        writes += 1;
        unit.customerGroupAssignments = [
          { customerGroup: { id: text(variables.groupId) } },
        ];
        unit.version += 1;
        if (lose) {
          lose = false;
          throw new Error("Lost after commit");
        }
        return Response.json({ data: { updateBusinessUnit: unit } });
      }
      return Response.json({ data: { businessUnit: unit } });
    }
    const unit = units.get(pathname.split("/").at(-1) ?? "");
    if (!unit) {
      throw new Error("Unexpected request");
    }
    if (request.method === "POST") {
      const body = Schema.decodeUnknownSync(Resource)(await request.json());
      const actions = Schema.decodeUnknownSync(Schema.Array(Resource))(
        body.actions
      );
      const stores = Schema.decodeUnknownSync(
        Schema.Array(
          Schema.Struct({ key: Schema.String, typeId: Schema.String })
        )
      )(actions[0]?.stores);
      unit.stores = [...stores];
      unit.version += 1;
      writes += 1;
    } else {
      reads += 1;
    }
    return Response.json(unit);
  };
  const sdk = new ClientBuilder()
    .withProjectKey("test")
    .withHttpMiddleware({
      enableRetry: false,
      host: "https://ct.example",
      httpClient: fetchApi,
    })
    .build();
  const api = createApiBuilderFromCtpClient(sdk).withProjectKey({
    projectKey: "test",
  });
  return {
    invalidate: () => {
      wrong = true;
    },
    layer: companyPurchasingPoliciesLayerFrom(api, bindings),
    lose: () => {
      lose = true;
    },
    reads: () => reads,
    units,
    writes: () => writes,
  };
};

describe("native Business Unit purchasing assignments", () => {
  it.effect(
    "preserves existing group assignments that conflict with an approval policy",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const unit = source.units.get("company-1");
        if (!unit) {
          throw new Error("Missing fixture Business Unit");
        }
        unit.stores.push({ key: policy.storeKey, typeId: "store" });
        unit.customerGroupAssignments = [
          { customerGroup: { id: "existing-group" } },
        ];
        yield* Effect.gen(function* () {
          const policies = yield* CompanyPurchasingPolicies;
          yield* policies.assign({ account, policy }).pipe(Effect.flip);
          expect(unit.customerGroupAssignments).toEqual([
            { customerGroup: { id: "existing-group" } },
          ]);
          expect(source.writes()).toBe(0);
        }).pipe(Effect.provide(source.layer));
      })
  );
  it.effect(
    "assigns the Customer Group, preserves Stores and reconciles a lost response",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* Effect.gen(function* () {
          const policies = yield* CompanyPurchasingPolicies;
          expect((yield* policies.list(policy.storeKey))[0]).not.toHaveProperty(
            "customerGroupId"
          );
          source.lose();
          yield* policies.assign({ account, policy }).pipe(Effect.flip);
          yield* policies.assign({ account, policy });
          expect(
            source.units.get("company-1")?.customerGroupAssignments
          ).toEqual([{ customerGroup: { id: "gold-id" } }]);
          expect(
            source.units.get("company-1")?.stores.map(({ key }) => key)
          ).toEqual(["other-store", policy.storeKey]);
          expect(source.writes()).toBe(2);
        }).pipe(Effect.provide(source.layer));
      })
  );
  it.effect(
    "rejects changed terms and mismatched native groups before assigning",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* Effect.gen(function* () {
          const policies = yield* CompanyPurchasingPolicies;
          yield* policies
            .assign({
              account,
              policy: { ...policy, pricingGroupKey: "other" },
            })
            .pipe(Effect.flip);
          expect(source.reads()).toBe(0);
          source.invalidate();
          yield* policies.assign({ account, policy }).pipe(Effect.flip);
          expect(source.writes()).toBe(0);
        }).pipe(Effect.provide(source.layer));
      })
  );
  it.effect("assigns different native groups to companies in one Store", () =>
    Effect.gen(function* () {
      const silver = {
        ...policy,
        customerGroupId: "silver-id",
        key: CompanyPurchasingPolicyKey.make("silver"),
        pricingGroupKey: "silver",
      };
      const source = fixture([policy, silver]);
      yield* Effect.gen(function* () {
        const policies = yield* CompanyPurchasingPolicies;
        yield* policies.assign({ account, policy });
        yield* policies.assign({
          account: new CommerceAccount({
            businessUnitId: CommerceBusinessUnitId.make("company-2"),
            customerId: account.customerId,
            registrationId: account.registrationId,
          }),
          policy: silver,
        });
        expect(
          [...source.units.values()].map(
            (unit) => unit.customerGroupAssignments
          )
        ).toEqual([
          [{ customerGroup: { id: "gold-id" } }],
          [{ customerGroup: { id: "silver-id" } }],
        ]);
      }).pipe(Effect.provide(source.layer));
    })
  );
});
