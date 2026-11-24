import "server-only";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import Link from "next/link";

import type { OrderAddress } from "../../domain/order-history";
import { OrderId } from "../../domain/order-identity";
import type { FulfillmentOrder } from "../model";
import { FulfillmentListInput } from "../model";
import type { FulfillmentAction } from "./actions";
import { fulfillmentErrorMessage } from "./actions";
import { fulfillmentHttpClient } from "./client";
import { FulfillmentQuantityForm } from "./quantity-form";

export type FulfillmentSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;
const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
const Destination = ({ address }: { readonly address: OrderAddress }) => (
  <address className="not-italic">
    {[
      address.recipient,
      address.company,
      address.addressLine1,
      address.addressLine2,
      address.city,
      address.region,
      address.postalCode,
      address.country,
    ]
      .filter(Boolean)
      .join(", ")}
  </address>
);
const Detail = ({
  order,
  canManage,
  locale,
  pack,
  ship,
}: {
  readonly order: FulfillmentOrder;
  readonly canManage: boolean;
  readonly locale: string;
  readonly pack: FulfillmentAction;
  readonly ship: FulfillmentAction;
}) => (
  <section className="grid gap-5">
    <h2 className="font-semibold text-xl">Order {order.number ?? order.id}</h2>
    {!order.writable && <p>This Order is closed for fulfillment.</p>}
    {order.groups.map((group) => (
      <section
        className="grid gap-3 rounded border bg-white p-5"
        key={group.id}
      >
        <h3 className="font-semibold">{group.name}</h3>
        {group.address && <Destination address={group.address} />}
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Item</th>
              <th>Ordered</th>
              <th>Packed</th>
              <th>Shipped</th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.name}
                  {line.sku && <small className="block">{line.sku}</small>}
                </td>
                <td>{line.ordered}</td>
                <td>{line.packed}</td>
                <td>{line.shipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canManage &&
          order.writable &&
          group.lines.some((line) => line.packed < line.ordered) && (
            <FulfillmentQuantityForm
              action={pack}
              fields={{
                groupId: group.id,
                locale,
                orderId: order.id,
                revision: order.revision,
              }}
              lines={group.lines.map((line) => ({
                id: line.id,
                name: line.name,
                remaining: line.ordered - line.packed,
              }))}
              operation="pack"
            />
          )}
        {group.deliveries.map((delivery) => {
          const lines = delivery.items.map((item) => ({
            id: item.lineItemId,
            name:
              group.lines.find((line) => line.id === item.lineItemId)?.name ??
              item.lineItemId,
            remaining:
              item.quantity -
              delivery.parcels
                .flatMap((parcel) => parcel.items)
                .filter((line) => line.lineItemId === item.lineItemId)
                .reduce((sum, line) => sum + line.quantity, 0),
          }));
          return (
            <section className="grid gap-3" key={delivery.id}>
              <h4 className="font-medium">Delivery {delivery.id}</h4>
              {delivery.address ? (
                <Destination address={delivery.address} />
              ) : (
                <p>Delivery destination has not been recorded.</p>
              )}

              {delivery.parcels.map((parcel) => (
                <p key={parcel.id}>
                  Parcel {parcel.id}:{" "}
                  {parcel.items
                    .map(
                      (item) =>
                        `${item.quantity} × ${group.lines.find((line) => line.id === item.lineItemId)?.name ?? item.lineItemId}`
                    )
                    .join(", ")}{" "}
                  {parcel.tracking?.carrier} {parcel.tracking?.number}
                </p>
              ))}
              {canManage &&
                order.writable &&
                lines.some((line) => line.remaining > 0) && (
                  <FulfillmentQuantityForm
                    action={ship}
                    fields={{
                      deliveryId: delivery.id,
                      locale,
                      orderId: order.id,
                      revision: order.revision,
                    }}
                    lines={lines}
                    operation="ship"
                  />
                )}
            </section>
          );
        })}
      </section>
    ))}
  </section>
);
export async function FulfillmentAdminPage({
  accessToken,
  canManage,
  searchParams,
  pack,
  ship,
}: {
  readonly accessToken: string | undefined;
  readonly canManage: boolean;
  readonly searchParams: FulfillmentSearchParams;
  readonly pack: FulfillmentAction;
  readonly ship: FulfillmentAction;
}) {
  const params = await searchParams;
  const locale = one(params.locale) ?? "en-US";
  const id = one(params.orderId);
  const rawNumber = one(params.orderNumber)?.trim();
  const orderNumber = rawNumber === "" ? undefined : rawNumber;
  const after = one(params.after);
  const result = accessToken
    ? await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* fulfillmentHttpClient(accessToken);
          const input = yield* Schema.decodeEffect(FulfillmentListInput)({
            after,
            limit: 20,
            orderNumber,
          });
          const page = yield* client.fulfillment.list({
            query: input,
            responseMode: "decoded-only",
          });
          const order = id
            ? yield* client.fulfillment.detail({
                params: { id: OrderId.make(id) },
                query: { locale },
                responseMode: "decoded-only",
              })
            : undefined;
          return { order, page };
        }).pipe(
          Effect.match({
            onFailure: (cause) => ({ error: fulfillmentErrorMessage(cause) }),
            onSuccess: (value) => ({ ...value, error: undefined }),
          }),
          Effect.provide(FetchHttpClient.layer)
        )
      )
    : { error: "Sign in again to read fulfillment." };
  return (
    <div className="grid gap-6">
      <h1 className="font-semibold text-3xl">Fulfillment</h1>
      <p>
        Pack Order quantities into deliveries, then ship parcels. Changes are
        saved in commercetools.
      </p>
      <form className="flex gap-3">
        <label>
          Order number
          <input
            className="ml-3 rounded border p-2"
            defaultValue={orderNumber}
            name="orderNumber"
          />
        </label>
        <button className="rounded border px-4" type="submit">
          Find pending Order
        </button>
      </form>
      {result.error === undefined ? (
        <>
          <ul className="grid gap-2">
            {result.page.items.map((order) => (
              <li key={order.id}>
                <Link
                  href={{
                    pathname: "/fulfillment",
                    query: { locale, orderId: order.id, orderNumber },
                  }}
                >
                  {order.number ?? order.id}
                </Link>{" "}
                {order.storeKey && <span>· {order.storeKey}</span>}
              </li>
            ))}
          </ul>
          {result.page.items.length === 0 && <p>No pending Orders found.</p>}
          {result.page.nextCursor && (
            <Link
              href={{
                pathname: "/fulfillment",
                query: { after: result.page.nextCursor, locale, orderNumber },
              }}
            >
              Next page
            </Link>
          )}
          {result.order && (
            <Detail
              canManage={canManage}
              locale={locale}
              order={result.order}
              pack={pack}
              ship={ship}
            />
          )}
        </>
      ) : (
        <p role="alert">{result.error}</p>
      )}
    </div>
  );
}
