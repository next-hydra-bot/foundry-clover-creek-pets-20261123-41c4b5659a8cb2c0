import type { ByProjectKeyRequestBuilder } from "@commercetools/platform-sdk";
import type { CommerceBusinessUnitId } from "@repo/commerce-core/domain/commerce-account";
import { stringifyDocument } from "@urql/core";
import { Effect, Schema } from "effect";

import type { CommercetoolsGraphQLClient } from "../client/graphql-client";
import { graphql } from "../graphql";

class BusinessUnitPricingFailure extends Schema.TaggedError<BusinessUnitPricingFailure>()(
  "BusinessUnitPricingFailure",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
  }
) {}

const groupsQuery = graphql(`
  query BusinessUnitPricingGroups($id: String!) {
    businessUnit(id: $id) {
      id
      customerGroupAssignments {
        customerGroup {
          id
        }
      }
    }
  }
`);

/** null inherits Customer pricing; [] explicitly opts out of Customer Group pricing. */
export const readBusinessUnitCustomerGroups = (
  client: CommercetoolsGraphQLClient["Service"],
  businessUnitId: CommerceBusinessUnitId
) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise(
      async () => await client.query(groupsQuery, { id: businessUnitId })
    );
    if (
      response.error ||
      !response.data?.businessUnit ||
      response.data.businessUnit.id !== businessUnitId
    ) {
      return yield* new BusinessUnitPricingFailure({
        message: "Business Unit Customer Group assignments could not be read",
      });
    }
    const groups = response.data.businessUnit.customerGroupAssignments;
    if (groups === null) {
      return null;
    }
    const ids: string[] = [];
    for (const assignment of groups) {
      if (!assignment.customerGroup) {
        return yield* new BusinessUnitPricingFailure({
          message: "A Business Unit Customer Group reference is unavailable",
        });
      }
      ids.push(assignment.customerGroup.id);
    }
    return [...new Set(ids)];
  });

const Unit = Schema.Struct({
  customerGroupAssignments: Schema.NullOr(
    Schema.Array(
      Schema.Struct({ customerGroup: Schema.Struct({ id: Schema.String }) })
    )
  ),
  id: Schema.String,
  version: Schema.Int,
});
const Response = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        businessUnit: Schema.optionalKey(Schema.NullOr(Unit)),
        updateBusinessUnit: Schema.optionalKey(Schema.NullOr(Unit)),
      })
    )
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

const assignmentQuery = graphql(`
  query AssignedBusinessUnitPricing($id: String!) {
    businessUnit(id: $id) {
      id
      version
      customerGroupAssignments {
        customerGroup {
          id
        }
      }
    }
  }
`);
const assignGroupMutation = graphql(`
  mutation AssignBusinessUnitPricing(
    $id: String!
    $version: Long!
    $groupId: String!
  ) {
    updateBusinessUnit(
      id: $id
      version: $version
      actions: [
        {
          setCustomerGroupAssignments: {
            customerGroupAssignments: [{ customerGroup: { id: $groupId } }]
          }
        }
      ]
    ) {
      id
      version
      customerGroupAssignments {
        customerGroup {
          id
        }
      }
    }
  }
`);

/** The REST SDK has not exposed this beta action; its authenticated GraphQL endpoint has. */
export const assignBusinessUnitCustomerGroup = (
  api: ByProjectKeyRequestBuilder,
  businessUnitId: string,
  customerGroupId: string
) =>
  Effect.gen(function* () {
    const execute = (
      query: string,
      variables: Record<string, string | number>
    ) =>
      Effect.tryPromise(
        async () =>
          await api.graphql().post({ body: { query, variables } }).execute()
      ).pipe(
        Effect.flatMap((result) =>
          Schema.decodeUnknownEffect(Response)(result.body)
        ),
        Effect.flatMap((response) =>
          (response.errors?.length ?? 0) > 0 || !response.data
            ? new BusinessUnitPricingFailure({
                message:
                  "Business Unit Customer Group assignment could not be confirmed",
              })
            : Effect.succeed(response.data)
        )
      );
    const data = yield* execute(stringifyDocument(assignmentQuery), {
      id: businessUnitId,
    });
    const unit = data.businessUnit;
    if (!unit || unit.id !== businessUnitId) {
      return yield* new BusinessUnitPricingFailure({
        message: "Business Unit identity did not match",
      });
    }
    const groups =
      unit.customerGroupAssignments?.map(
        (assignment) => assignment.customerGroup.id
      ) ?? [];
    if (groups.length === 1 && groups[0] === customerGroupId) {
      return;
    }
    if (groups.length > 0) {
      return yield* new BusinessUnitPricingFailure({
        message:
          "Business Unit already has different Customer Group assignments; reconcile them before assigning this purchasing policy",
      });
    }
    const saved = yield* execute(stringifyDocument(assignGroupMutation), {
      groupId: customerGroupId,
      id: businessUnitId,
      version: unit.version,
    });
    const updated = saved.updateBusinessUnit;
    if (
      !updated ||
      updated.id !== businessUnitId ||
      updated.customerGroupAssignments?.length !== 1 ||
      updated.customerGroupAssignments[0]?.customerGroup.id !== customerGroupId
    ) {
      return yield* new BusinessUnitPricingFailure({
        message:
          "Business Unit Customer Group assignment could not be confirmed; retry to reconcile it",
      });
    }
    return updated;
  });
