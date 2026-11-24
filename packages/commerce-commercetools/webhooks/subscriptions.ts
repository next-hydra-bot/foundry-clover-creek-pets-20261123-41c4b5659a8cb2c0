import { Array, Order } from "effect";

export interface EventSubscription {
  readonly changes: readonly { readonly resourceTypeId: string }[];
  readonly messages: readonly {
    readonly resourceTypeId: string;
    readonly types: readonly string[];
  }[];
}

/** A single native Subscription covers every installed consumer. An empty types list means all messages. */
export const combineSubscriptions = (
  subscriptions: readonly EventSubscription[]
): EventSubscription => {
  const resources = Array.sort(
    [
      ...new Set(
        subscriptions.flatMap(({ messages }) =>
          messages.map(({ resourceTypeId }) => resourceTypeId)
        )
      ),
    ],
    Order.String
  );
  return {
    changes: Array.sort(
      [
        ...new Set(
          subscriptions.flatMap(({ changes }) =>
            changes.map(({ resourceTypeId }) => resourceTypeId)
          )
        ),
      ],
      Order.String
    ).map((resourceTypeId) => ({ resourceTypeId })),
    messages: resources.map((resourceTypeId) => {
      const entries = subscriptions.flatMap(({ messages }) =>
        messages.filter((entry) => entry.resourceTypeId === resourceTypeId)
      );
      return {
        resourceTypeId,
        types: entries.some((entry) => entry.types.length === 0)
          ? []
          : Array.sort(
              [...new Set(entries.flatMap((entry) => entry.types))],
              Order.String
            ),
      };
    }),
  };
};
