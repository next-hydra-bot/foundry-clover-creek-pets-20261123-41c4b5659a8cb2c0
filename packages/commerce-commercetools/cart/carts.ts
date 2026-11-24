/* oxlint-disable unicorn/no-array-method-this-argument -- Effect.forEach takes an iterable and callback; these are not Array thisArg calls. */
import type {
  ByProjectKeyRequestBuilder,
  CartUpdateAction,
} from "@commercetools/platform-sdk";
import {
  productTypeDefinition,
  productModel,
  modelLabel,
} from "@repo/commerce-core/catalog/product-model";
import type { AddressBookReference } from "@repo/commerce-core/domain/address-book";
import {
  CartId,
  LineItemId,
  ProductId,
  Sku,
} from "@repo/commerce-core/domain/cart";
import type { VariantId } from "@repo/commerce-core/domain/cart";
import {
  CartAccessDenied,
  CartLineItemNotFound,
  CartMerchandiseUnavailable,
  CartNotFound,
  CartProviderFailure,
  CartShippingOptionsRefreshRequired,
  CartShippingSelectionUnavailable,
  CartWriteConflict,
  CartWriteOutcomeUnknown,
  cartMutationRejected,
} from "@repo/commerce-core/domain/cart-errors";
import type { CartOperation } from "@repo/commerce-core/domain/cart-errors";
import {
  CartLineItemSummaryAttribute,
  CartSnapshot,
  ProductTypeKey as CartProductTypeKey,
} from "@repo/commerce-core/domain/cart-snapshot";
import type {
  CartTarget,
  CartTax,
} from "@repo/commerce-core/domain/cart-snapshot";
import {
  ShippingAddress,
  StorefrontAnonymousCheckoutScope,
  StorefrontCustomerCheckoutScope,
  StorefrontB2CCheckoutScope,
} from "@repo/commerce-core/domain/checkout";
import type {
  CheckoutDeliveryDetails,
  CheckoutDetails,
} from "@repo/commerce-core/domain/checkout";
import {
  CommerceCustomerId,
  CommerceBusinessUnitId,
} from "@repo/commerce-core/domain/commerce-account";
import type {
  DeliveryPlanQuoteReference,
  DeliveryPlanReference,
  SelectedDeliveryGroup,
  SelectedDeliveryPlan,
} from "@repo/commerce-core/domain/delivery-plan";
import { CurrencyCode } from "@repo/commerce-core/domain/money";
import { Carts } from "@repo/commerce-core/services/carts";
import type {
  AddCartItem,
  ClearCartPaymentOptions,
  CreateAnonymousCart,
  CreateBusinessUnitCart,
  CreateCustomerCart,
  FindActiveCartsForCustomer,
  FindActiveCartsForBusinessUnit,
  FindCartById,
  RemoveCartLineItem,
  SaveCartContact,
  SaveCartDeliveryDetails,
  SaveCartPaymentOptions,
  SaveCartShippingOptions,
  SetCartLineItemQuantity,
  ChangeCartDiscountCode,
  ChangeCartDiscountCodeFailure,
} from "@repo/commerce-core/services/carts";
import { StoreKey } from "@repo/commerce-core/store";
import {
  cardPreparationReferenceFor,
  PaymentCheckoutReference,
  PaymentProviderReference,
  PreparedPayment as PreparedPaymentSchema,
} from "@repo/payments";
import type { PreparedPayment } from "@repo/payments";
import type { Client } from "@urql/core";
import { Effect, Layer, Option, Schema } from "effect";
import type { FragmentOf } from "gql.tada";

import { fromCommercetoolsAddressKey } from "../address-book/address-book-key";
import { CommercetoolsGraphQLClient } from "../client/graphql-client";
import { CommercetoolsRestClient } from "../client/rest-client";
import {
  commercetoolsFailureCause,
  commercetoolsRequest,
  hasCommercetoolsErrorCode,
  isCommercetoolsAccessDenied,
  isCommercetoolsClientFailure,
  isConcurrentModification,
  PreserveVersionedWriteConflict,
  RetryVersionedWrite,
  retryVersionedWrite,
} from "../client/versioned-write";
import type {
  CommercetoolsConcurrentModification,
  VersionedWriteConflictResolution,
} from "../client/versioned-write";
import { customFieldsReader, PaymentCustomFields } from "../custom-fields";
import type { GraphqlCustomFieldsInput } from "../custom-fields";
import {
  deliveryAddressKeyFor,
  deliveryReferencesFromShippingKey,
  shippingOptionReferenceFor,
} from "../delivery-planning/references";
import { readFragment } from "../graphql";
import {
  cardPaymentKeyForCheckout,
  netTermsPaymentKeyForCheckout,
} from "../payment-repository/keys";
import {
  localizedTextForLocale,
  productAttributesReader,
} from "../product-attributes";
import type { ProductAttributeRaw } from "../product-attributes";
import {
  resolveVariantReference,
  variantReference,
} from "../product/variant-reference";
import { CheckoutOrderCustomFields } from "./checkout-custom-fields";
import {
  buildSaveCheckoutContactUpdate,
  hasPersistedCheckoutContact,
  ORDER_CUSTOM_TYPE_KEY,
} from "./contact-actions";
import { buildSaveCheckoutDeliveryDetailsUpdate } from "./delivery-details-actions";
import { aggregateDiscounts, discountPortions } from "./discounts";
import { CartFragment } from "./graphql/fragments";
import {
  AddItemToCartMutation,
  ChangeItemsQuantityMutation,
  CreateCartMutation,
  RemoveItemFromCartMutation,
  SaveCheckoutContactMutation,
  SaveCheckoutDeliveryDetailsMutation,
} from "./graphql/mutations";
import {
  CartDistributionChannelQuery,
  GetActiveCartForBusinessUnitAsAssociateQuery,
  GetCartByIdQuery,
  GetActiveCartsForCustomerQuery,
} from "./graphql/queries";
import {
  buildSavePaymentOptionsActions,
  clearSelectedPaymentActions,
} from "./payment-options-actions";
// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Legacy adapter export; the local name states its domain destination.
import { payableTotal, toCartPrice } from "./price";
import type {
  CommercetoolsAddress,
  CommercetoolsCart,
  CommercetoolsLineItem,
  CommercetoolsPayment,
} from "./provider-cart";
import {
  buildSaveShippingOptionsActions,
  clearSelectedDeliveryPlanActions,
} from "./shipping-options-actions";

type GraphqlClient = Pick<Client, "query" | "mutation">;

type Mutable<Value> = {
  -readonly [Key in keyof Value]: Value[Key];
};

type CartProductVariantCandidate = {
  readonly id: VariantId;
  readonly images: NonNullable<CommercetoolsLineItem["variant"]>["images"];
  readonly name?: string;
  readonly productId: ProductId;
  readonly productType?: CartProductTypeKey;
  readonly sku?: Sku;
  readonly summaryAttribute?: CartLineItemSummaryAttribute;
};

type CartLineItemCandidate = {
  readonly discounts?: CartSnapshot["lineItems"][number]["discounts"];
  readonly regularUnitPrice?: CommercetoolsLineItem["price"]["value"];
  readonly subtotalPrice?: CommercetoolsLineItem["price"]["value"];
  readonly id: LineItemId;
  readonly quantity: number;
  readonly totalPrice?: CommercetoolsLineItem["totalPrice"];
  readonly unitPrice: CommercetoolsLineItem["price"]["value"];
  readonly variant?: CartProductVariantCandidate;
};

type CartProductAttributeDefinition = {
  readonly labelAllLocales: readonly {
    readonly locale: string;
    readonly value: string;
  }[];
  readonly name: string;
};

type CartSnapshotCandidate = {
  readonly tax?: CartSnapshot["tax"];
  readonly totalPriceEstimated?: boolean;
  readonly discountCodes?: CartSnapshot["discountCodes"];
  readonly discounts?: CartSnapshot["discounts"];
  readonly subtotalPrice?: CartSnapshot["totalPrice"];
  readonly customerId?: CommerceCustomerId;
  readonly buyingContext?: {
    readonly businessUnitId: CommerceBusinessUnitId;
  };
  readonly checkoutDetails: CheckoutDetails;
  readonly id: CartId;
  readonly lineItems: readonly CartLineItemCandidate[];
  readonly status: "active" | "inactive";
  readonly storeKey?: StoreKey;
  readonly totalLineItemQuantity: number;
  readonly totalPrice: CommercetoolsCart["totalPrice"];
};

type MutableCheckoutDetails = Mutable<CheckoutDetails>;
type ProjectedShippingTarget = Mutable<
  NonNullable<
    NonNullable<CommercetoolsLineItem["shippingDetails"]>["targets"][number]
  >
>;
type ProjectedCommercetoolsVariant = Mutable<
  NonNullable<CommercetoolsLineItem["variant"]>
>;
type ProjectedCommercetoolsLineItem = Mutable<CommercetoolsLineItem>;
type ProjectedCommercetoolsCart = Mutable<CommercetoolsCart>;
type MutableCartProductVariantCandidate = Mutable<CartProductVariantCandidate>;
type MutableCartLineItemCandidate = Mutable<CartLineItemCandidate>;
type MutableCartSnapshotCandidate = Mutable<CartSnapshotCandidate>;

type ProviderErrorPayload = {
  readonly networkError?: unknown;
};

// ---------------------------------------------------------------------------
// Failures
//
// This Layer owns the only projection from a Commercetools failure to a Cart
// domain failure. Per ADR-0005 an infrastructure adapter inspects an untyped
// provider exception once; no intermediate error vocabulary sits between the
// provider and the capability contract.
// ---------------------------------------------------------------------------

const providerFailure = (
  operation: CartOperation,
  cause: unknown,
  reason: "unavailable" | "invalidData" | "unexpectedResponse"
) =>
  new CartProviderFailure({
    cause,
    operation,
    reason,
  });

const accessDenied = (operation: CartOperation, cartId?: CartId) =>
  cartId === undefined
    ? new CartAccessDenied({ operation })
    : new CartAccessDenied({ cartId, operation });

const writeOutcomeUnknown = (operation: CartOperation, cartId?: CartId) =>
  cartId === undefined
    ? new CartWriteOutcomeUnknown({ operation })
    : new CartWriteOutcomeUnknown({ cartId, operation });

const providerContractDefect = (message: string) => new Error(message);

/** A provider response that violates its documented contract is a defect. */
const dieOnContractViolation = (message: string) =>
  Effect.die(providerContractDefect(message));

const failedRead = (
  operation: CartOperation,
  cartId: CartId | undefined,
  error: ProviderErrorPayload
): Effect.Effect<never, CartAccessDenied | CartProviderFailure> => {
  if (error.networkError !== undefined) {
    return Effect.fail(providerFailure(operation, error, "unavailable"));
  }

  if (isCommercetoolsAccessDenied(error)) {
    return Effect.fail(accessDenied(operation, cartId));
  }

  return Effect.die(error);
};

const failedWrite = (
  operation: CartOperation,
  cartId: CartId,
  cause: unknown
): Effect.Effect<
  never,
  CartAccessDenied | CartWriteConflict | CartWriteOutcomeUnknown
> => {
  const providerCause = commercetoolsFailureCause(cause);

  if (isConcurrentModification(cause)) {
    return Effect.fail(new CartWriteConflict({ cartId, operation }));
  }

  if (isCommercetoolsAccessDenied(providerCause)) {
    return Effect.fail(new CartAccessDenied({ cartId, operation }));
  }

  if (isCommercetoolsClientFailure(providerCause)) {
    return Effect.die(providerCause);
  }

  return Effect.fail(new CartWriteOutcomeUnknown({ cartId, operation }));
};

const failedShippingWrite = (
  cartId: CartId,
  cause: unknown
): Effect.Effect<
  never,
  | CartAccessDenied
  | CartShippingSelectionUnavailable
  | CartWriteConflict
  | CartWriteOutcomeUnknown
> => {
  const providerCause = commercetoolsFailureCause(cause);
  if (
    hasCommercetoolsErrorCode(
      providerCause,
      "InvalidOperation",
      "InvalidItemShippingDetails",
      "ReferencedResourceNotFound",
      "ResourceNotFound",
      "ShippingMethodDoesNotMatchCart",
      "PriceChanged",
      "MatchingPriceNotFound"
    )
  ) {
    return Effect.fail(
      new CartShippingSelectionUnavailable({
        cartId,
        operation: "saveShippingOptions",
      })
    );
  }
  return failedWrite("saveShippingOptions", cartId, cause);
};

const failedCreate = (
  operation: "createAnonymous" | "createForBusinessUnit" | "createForCustomer",
  cause: unknown
): Effect.Effect<never, CartAccessDenied | CartWriteOutcomeUnknown> => {
  const providerCause = commercetoolsFailureCause(cause);

  if (isCommercetoolsAccessDenied(providerCause)) {
    return Effect.fail(new CartAccessDenied({ operation }));
  }

  if (isCommercetoolsClientFailure(providerCause)) {
    return Effect.die(providerCause);
  }

  return Effect.fail(new CartWriteOutcomeUnknown({ operation }));
};

const failedMutation = (
  operation: CartOperation,
  cartId: CartId | undefined,
  error: ProviderErrorPayload
): Effect.Effect<never, CartAccessDenied | CartWriteOutcomeUnknown> => {
  if (error.networkError !== undefined) {
    return Effect.fail(writeOutcomeUnknown(operation, cartId));
  }

  if (isCommercetoolsAccessDenied(error)) {
    return Effect.fail(accessDenied(operation, cartId));
  }

  return Effect.die(error);
};

/**
 * A mutation that reports success without returning its Cart leaves the write
 * outcome ambiguous: it may already have been applied.
 */
const missingCartData = (operation: CartOperation, cartId?: CartId) =>
  Effect.fail(writeOutcomeUnknown(operation, cartId));

// ---------------------------------------------------------------------------
// Projections
//
// `toCommercetoolsCart` reads a provider response into the provider's own Cart,
// which carries the resource `version` that writes need. `toCart` projects that
// into the provider-neutral domain Cart at the edge of the capability.
// ---------------------------------------------------------------------------

const projectCartLineItemSummaryAttribute = Effect.fn(
  "CommercetoolsCarts.projectCartLineItemSummaryAttribute"
)(function* (
  productType: CartProductTypeKey | undefined,
  attributesRaw: readonly ProductAttributeRaw[],
  definitions: readonly CartProductAttributeDefinition[],
  locale: string
) {
  if (productType === undefined) {
    return undefined;
  }

  const type = productTypeDefinition(productType);
  const keys = type.cartSummary ?? type.variantOptions;
  if (keys.length === 0) {
    return undefined;
  }
  const attributes = yield* productAttributesReader.fromGraphql(
    productType,
    attributesRaw,
    { locale }
  ).read;
  const values = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.Json)
  )(attributes);
  const parts = keys.flatMap((key) => {
    const value = values[key];
    const attribute = type.attributes.find(
      (attribute) => attribute.key === key
    );
    if (attribute === undefined || value === undefined) {
      return [];
    }
    const native = definitions.find(({ name }) => name === key);
    const label =
      native === undefined
        ? Option.some(
            modelLabel(attribute.labels, locale, productModel.defaultLocale)
          )
        : localizedTextForLocale(
            Object.fromEntries(
              native.labelAllLocales.map(({ locale, value }) => [locale, value])
            ),
            locale
          );
    if (Option.isNone(label)) {
      return [];
    }
    const display =
      attribute.type === "enum"
        ? Schema.decodeUnknownSync(Schema.Struct({ label: Schema.String }))(
            value
          ).label
        : String(
            Schema.decodeUnknownSync(
              Schema.Union([Schema.String, Schema.Finite])
            )(value)
          );
    return [{ label: label.value, value: display }];
  });
  if (parts.length === 0) {
    return undefined;
  }
  return yield* Schema.decodeUnknownEffect(CartLineItemSummaryAttribute)({
    label: parts.map(({ label }) => label).join(" / "),
    value: parts.map(({ value }) => value).join(" / "),
  });
});

const CommerceShippingAddress = Schema.Struct({
  additionalStreetInfo: Schema.NullOr(Schema.String),
  city: Schema.NullOr(Schema.String),
  country: Schema.String,
  key: Schema.NullOr(Schema.String),
  postalCode: Schema.NullOr(Schema.String),
  region: Schema.NullOr(Schema.String),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  streetName: Schema.NullOr(Schema.String),
  streetNumber: Schema.optional(Schema.NullOr(Schema.String)),
});

type CommerceShippingAddressInput = {
  readonly additionalStreetInfo?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly key?: string | null;
  readonly postalCode?: string | null;
  readonly region?: string | null;
  readonly state?: string | null;
  readonly streetName?: string | null;
  readonly streetNumber?: string | null;
};

type DecodedShippingAddress = {
  readonly shippingAddress: ShippingAddress;
  readonly addressBookReference?: AddressBookReference;
};

const decodeShippingAddress = (
  value: CommerceShippingAddressInput | null | undefined
): Option.Option<DecodedShippingAddress> =>
  Schema.decodeUnknownOption(CommerceShippingAddress)(value).pipe(
    Option.flatMap((address) =>
      Schema.decodeUnknownOption(ShippingAddress)({
        addressLine1: [address.streetNumber, address.streetName]
          .filter(Boolean)
          .join(" "),
        addressLine2: address.additionalStreetInfo ?? undefined,
        city: address.city,
        country: address.country,
        postalCode: address.postalCode,
        region: address.state ?? address.region ?? undefined,
      }).pipe(
        Option.map((shippingAddress) => {
          const addressBookReference =
            address.key === null
              ? undefined
              : fromCommercetoolsAddressKey(address.key);

          return { addressBookReference, shippingAddress };
        })
      )
    )
  );

const getCheckoutDeliveryDetails = (
  persisted: CheckoutDeliveryDetails | undefined,
  decodedShippingAddress: DecodedShippingAddress | null
): CheckoutDeliveryDetails | undefined => {
  if (persisted !== undefined) {
    return persisted;
  }

  if (decodedShippingAddress === null) {
    return;
  }

  const { addressBookReference, shippingAddress } = decodedShippingAddress;

  return addressBookReference === undefined
    ? { shippingAddress, source: "manual" }
    : { addressBookReference, shippingAddress, source: "addressBook" };
};

const getCheckoutDetails = (
  custom: GraphqlCustomFieldsInput | null | undefined,
  decodedShippingAddress: DecodedShippingAddress | null,
  preparedPayment: PreparedPayment | undefined
): Effect.Effect<CheckoutDetails, Schema.SchemaError> =>
  customFieldsReader.fromGraphql(CheckoutOrderCustomFields, custom).read.pipe(
    Effect.map((decoded) => {
      const fields = Option.getOrUndefined(decoded);
      const deliveryDetails = getCheckoutDeliveryDetails(
        fields?.checkoutDeliveryDetails,
        decodedShippingAddress
      );
      const details: MutableCheckoutDetails = {};
      if (fields?.checkoutContact !== undefined) {
        details.contact = fields.checkoutContact;
      }
      if (deliveryDetails !== undefined) {
        details.deliveryDetails = deliveryDetails;
      }
      if (preparedPayment !== undefined) {
        details.preparedPayment = preparedPayment;
      }
      return details;
    })
  );

const decodeCurrencyCode = Schema.decodeUnknownSync(CurrencyCode);

const preparedPaymentFrom = (
  cartId: string,
  billingAddress: ShippingAddress | null,
  payment: CommercetoolsPayment
): Effect.Effect<Option.Option<PreparedPayment>, Schema.SchemaError> =>
  Effect.gen(function* () {
    if (billingAddress === null) {
      return Option.none<PreparedPayment>();
    }

    const checkout = {
      amount: payment.amountPlanned,
      reference: PaymentCheckoutReference.make(cartId),
    };
    if (
      payment.paymentMethodInfo.method === "card" &&
      payment.key === cardPaymentKeyForCheckout(cartId) &&
      Schema.is(PaymentProviderReference)(payment.interfaceId) &&
      payment.paymentMethodInfo.paymentInterface !== null &&
      payment.paymentMethodInfo.paymentInterface !== undefined
    ) {
      const fields = Option.getOrUndefined(
        yield* customFieldsReader.fromGraphql(
          PaymentCustomFields,
          payment.custom
        ).read
      );
      const prepared = yield* Schema.decodeUnknownEffect(PreparedPaymentSchema)(
        {
          amount: payment.amountPlanned,
          attemptReference: fields?.checkoutPlacementAttemptReference,
          billingAddress,
          method: "card",
          paymentReference: payment.id,
          preparationReference: cardPreparationReferenceFor(checkout),
        }
      );
      return Option.some(prepared);
    }

    if (
      payment.paymentMethodInfo.method === "netTerms" &&
      payment.key === netTermsPaymentKeyForCheckout(cartId) &&
      payment.interfaceId !== null &&
      payment.interfaceId !== undefined &&
      payment.paymentMethodInfo.paymentInterface !== null &&
      payment.paymentMethodInfo.paymentInterface !== undefined
    ) {
      const fields = Option.getOrUndefined(
        yield* customFieldsReader.fromGraphql(
          PaymentCustomFields,
          payment.custom
        ).read
      );
      const prepared = yield* Schema.decodeUnknownEffect(PreparedPaymentSchema)(
        {
          amount: payment.amountPlanned,
          attemptReference: fields?.checkoutPlacementAttemptReference,
          billingAddress,
          method: "netTerms",
          paymentReference: payment.id,
          termsInDays: fields?.checkoutTermsInDays,
        }
      );
      return Option.some(prepared);
    }

    return Option.none<PreparedPayment>();
  });

const selectedDeliveryPlanFrom = (
  cartId: string,
  lineItems: readonly CommercetoolsLineItem[],
  shipping: CommercetoolsCart["shipping"]
): SelectedDeliveryPlan | undefined => {
  for (const lineItem of lineItems) {
    const shippingTargetQuantity =
      lineItem.shippingDetails?.targets.reduce(
        (total, target) => total + target.quantity,
        0
      ) ?? 0;
    if (
      lineItem.shippingDetails?.valid === false ||
      (shipping.length === 0 && shippingTargetQuantity > 0) ||
      (shipping.length > 0 && shippingTargetQuantity !== lineItem.quantity)
    ) {
      return;
    }
    for (const target of lineItem.shippingDetails?.targets ?? []) {
      if (
        target.shippingMethodKey === undefined ||
        !shipping.some(
          (entry) => entry.shippingKey === target.shippingMethodKey
        )
      ) {
        return;
      }
    }
  }
  if (shipping.length === 0) {
    return;
  }
  if (
    shipping.some(
      (entry) => entry.shippingInfo.shippingMethodState !== "MatchesCart"
    )
  ) {
    return;
  }

  const quoteReferences = new Set<DeliveryPlanQuoteReference>();
  const planReferences = new Set<DeliveryPlanReference>();
  const groupReferences = new Set<string>();
  const groups = shipping.map((entry): SelectedDeliveryGroup => {
    const references = deliveryReferencesFromShippingKey(entry.shippingKey);
    const { shippingMethodId } = entry.shippingInfo;
    const decodedAddress = Option.getOrUndefined(
      decodeShippingAddress(entry.shippingAddress)
    );
    if (
      references === undefined ||
      shippingMethodId === undefined ||
      decodedAddress === undefined
    ) {
      throw new Error(
        `Commercetools Cart ${cartId} contains an invalid selected Delivery Plan`
      );
    }
    if (groupReferences.has(references.reference)) {
      throw new Error(
        `Commercetools Cart ${cartId} contains a duplicate Delivery Group`
      );
    }
    groupReferences.add(references.reference);
    quoteReferences.add(references.quoteReference);
    planReferences.add(references.planReference);

    const targets = lineItems.flatMap((lineItem) =>
      (lineItem.shippingDetails?.targets ?? []).flatMap((target) => {
        if (target.shippingMethodKey !== entry.shippingKey) {
          return [];
        }
        if (target.addressKey !== deliveryAddressKeyFor(references.reference)) {
          throw new Error(
            `Commercetools Cart ${cartId} contains a Delivery Target with the wrong address`
          );
        }
        return [
          {
            lineItemId: LineItemId.make(lineItem.id),
            quantity: target.quantity,
          },
        ];
      })
    );
    const [firstTarget, ...remainingTargets] = targets;
    if (firstTarget === undefined) {
      throw new Error(
        `Commercetools Cart ${cartId} contains a Delivery Group without targets`
      );
    }

    return {
      reference: references.reference,
      selectedShippingOption: {
        name: entry.shippingInfo.shippingMethodName,
        price: entry.shippingInfo.price,
        reference: shippingOptionReferenceFor(shippingMethodId),
      },
      shippingAddress: decodedAddress.shippingAddress,
      targets: [firstTarget, ...remainingTargets],
    };
  });
  const [firstGroup, ...remainingGroups] = groups;
  const [quoteReference] = quoteReferences;
  const [planReference] = planReferences;

  if (
    firstGroup === undefined ||
    quoteReference === undefined ||
    planReference === undefined ||
    quoteReferences.size !== 1 ||
    planReferences.size !== 1
  ) {
    throw new Error(
      `Commercetools Cart ${cartId} contains inconsistent Delivery Plan quote references`
    );
  }

  return {
    groups: [firstGroup, ...remainingGroups],
    quoteReference,
    reference: planReference,
  };
};

const toCommercetoolsCart = (
  fragment: FragmentOf<typeof CartFragment>,
  locale: string
): Effect.Effect<CommercetoolsCart, Schema.SchemaError> =>
  Effect.gen(function* () {
    const parsedData = readFragment(CartFragment, fragment);
    const decodedShippingAddress = Option.getOrNull(
      decodeShippingAddress(parsedData.shippingAddress)
    );
    const shippingAddress = decodedShippingAddress?.shippingAddress ?? null;
    const billingAddress =
      Option.getOrNull(decodeShippingAddress(parsedData.billingAddress))
        ?.shippingAddress ?? null;

    const lineItems: CommercetoolsLineItem[] = yield* Effect.forEach(
      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- This is Effect.forEach's iterable argument, not Array#forEach's thisArg.
      parsedData.lineItems,
      (item) =>
        Effect.gen(function* () {
          const productType =
            item.productType?.key === null ||
            item.productType?.key === undefined
              ? undefined
              : yield* Schema.decodeUnknownEffect(CartProductTypeKey)(
                  item.productType.key
                );
          const shippingDetails =
            item.shippingDetails === null || item.shippingDetails === undefined
              ? null
              : {
                  targets: item.shippingDetails.targets.map((target) => {
                    const projectedTarget: ProjectedShippingTarget = {
                      addressKey: target.addressKey,
                      quantity: target.quantity,
                    };
                    if (target.shippingMethodKey !== null) {
                      projectedTarget.shippingMethodKey =
                        target.shippingMethodKey;
                    }
                    return projectedTarget;
                  }),
                  valid: item.shippingDetails.valid,
                };
          let variant: CommercetoolsLineItem["variant"] = null;
          if (item.variant !== null) {
            const summaryAttribute = yield* projectCartLineItemSummaryAttribute(
              productType,
              item.variant.attributesRaw,
              item.productType?.attributeDefinitions.results ?? [],
              locale
            );
            const projectedVariant: ProjectedCommercetoolsVariant = {
              id: item.variant.id,
              images: item.variant.images.map((image) => ({
                altText: image.label ?? "",
                url: image.url,
              })),
            };
            if (item.variant.sku !== null) {
              projectedVariant.sku = item.variant.sku;
            }
            if (summaryAttribute !== undefined) {
              projectedVariant.summaryAttribute = summaryAttribute;
            }
            variant = projectedVariant;
          }

          const lineItem: ProjectedCommercetoolsLineItem = {
            discounts: aggregateDiscounts(
              (item.discountedPricePerQuantity ?? []).flatMap((group) =>
                discountPortions(
                  group.discountedPrice.includedDiscounts,
                  "items",
                  group.quantity
                )
              )
            ),
            distributionChannel: item.distributionChannel,
            id: item.id,
            name: item.name,
            price: toCartPrice(item.price),
            productId: item.productId,
            quantity: item.quantity,
            shippingDetails,
            totalPrice: item.totalPrice
              ? {
                  centAmount: item.totalPrice.centAmount,
                  currencyCode: decodeCurrencyCode(
                    item.totalPrice.currencyCode
                  ),
                }
              : null,
            variant,
          };
          if (productType !== undefined) {
            lineItem.productType = productType;
          }
          return lineItem;
        })
    );
    const itemShippingAddresses: CommercetoolsAddress[] = (
      parsedData.itemShippingAddresses ?? []
    ).map((address) => ({
      additionalStreetInfo: address.additionalStreetInfo,
      city: address.city,
      country: address.country,
      key: address.key,
      postalCode: address.postalCode,
      region: address.region,
      state: address.state,
      streetName: address.streetName,
      streetNumber: address.streetNumber,
    }));
    const shipping: CommercetoolsCart["shipping"] = (
      parsedData.shipping ?? []
    ).map((entry): CommercetoolsCart["shipping"][number] => {
      if (
        entry.shippingKey === null ||
        entry.shippingAddress === null ||
        entry.shippingInfo === null ||
        entry.shippingInfo.shippingMethodRef === null
      ) {
        throw new Error(
          `Commercetools Cart ${parsedData.id} contains incomplete native shipping data`
        );
      }

      return {
        shippingAddress: {
          additionalStreetInfo: entry.shippingAddress.additionalStreetInfo,
          city: entry.shippingAddress.city,
          country: entry.shippingAddress.country,
          key: entry.shippingAddress.key,
          postalCode: entry.shippingAddress.postalCode,
          region: entry.shippingAddress.region,
          state: entry.shippingAddress.state,
          streetName: entry.shippingAddress.streetName,
          streetNumber: entry.shippingAddress.streetNumber,
        },
        shippingInfo: {
          price: {
            centAmount: entry.shippingInfo.price.centAmount,
            currencyCode: decodeCurrencyCode(
              entry.shippingInfo.price.currencyCode
            ),
          },
          shippingMethodId: entry.shippingInfo.shippingMethodRef.id,
          shippingMethodName: entry.shippingInfo.shippingMethodName,
          shippingMethodState: entry.shippingInfo.shippingMethodState,
        },
        shippingKey: entry.shippingKey,
      };
    });
    const selectedDeliveryPlan = selectedDeliveryPlanFrom(
      parsedData.id,
      lineItems,
      shipping
    );
    const payments: CommercetoolsPayment[] = (
      parsedData.paymentInfo?.payments ?? []
    )
      .filter((payment) =>
        parsedData.paymentInfo?.paymentRefs.some(
          (reference) => reference.id === payment.id
        )
      )
      .map((payment) => ({
        amountPlanned: {
          centAmount: payment.amountPlanned.centAmount,
          currencyCode: decodeCurrencyCode(payment.amountPlanned.currencyCode),
        },
        custom:
          payment.custom === null
            ? null
            : {
                customFieldsRaw: payment.custom.customFieldsRaw,
                type: payment.custom.type,
              },
        id: payment.id,
        interfaceId: payment.interfaceId,
        key: payment.key,
        paymentMethodInfo: payment.paymentMethodInfo,
      }));
    const preparedPayment =
      payments.length === 1 && payments[0] !== undefined
        ? Option.getOrUndefined(
            yield* preparedPaymentFrom(
              parsedData.id,
              billingAddress,
              payments[0]
            )
          )
        : undefined;
    const checkoutDetails = yield* getCheckoutDetails(
      parsedData.custom,
      decodedShippingAddress,
      preparedPayment
    );

    const checkoutDetailsWithShipping: MutableCheckoutDetails = {
      ...checkoutDetails,
    };
    if (selectedDeliveryPlan !== undefined) {
      checkoutDetailsWithShipping.selectedDeliveryPlan = selectedDeliveryPlan;
    }

    const cart: ProjectedCommercetoolsCart = {
      ...parsedData,
      productDiscountsApplied:
        parsedData.discountTypeCombination?.__typename !== "BestDeal" ||
        parsedData.discountTypeCombination.chosenDiscountType !==
          "CartDiscount",
      billingAddress,
      checkoutDetails: checkoutDetailsWithShipping,
      customerId: parsedData.customerId ?? undefined,
      deletedDiscountCodeIds: (parsedData.discountCodes ?? [])
        .filter((entry) => entry.discountCode === null)
        .map((entry) => entry.discountCodeRef.id),
      discountCodes: (parsedData.discountCodes ?? []).flatMap((entry) =>
        entry.discountCode === null
          ? []
          : [
              {
                applicable: entry.state === "MatchesCart",
                code: entry.discountCode.code,
                id: entry.discountCodeRef.id,
              },
            ]
      ),
      discounts: aggregateDiscounts([
        ...lineItems.flatMap((line) => line.discounts ?? []),
        ...discountPortions(
          parsedData.discountOnTotalPrice?.includedDiscounts ?? [],
          "total"
        ),
        ...discountPortions(
          parsedData.shippingMode === "Single"
            ? (parsedData.shippingInfo?.discountedPrice?.includedDiscounts ??
                [])
            : (parsedData.shipping ?? []).flatMap(
                (entry) =>
                  entry.shippingInfo?.discountedPrice?.includedDiscounts ?? []
              ),
          "shipping"
        ),
      ]),
      itemShippingAddresses,
      lineItems,
      paymentIds:
        parsedData.paymentInfo?.paymentRefs.map((payment) => payment.id) ?? [],
      payments,
      shipping,
      shippingAddress,
      totalLineItemQuantity: parsedData.totalLineItemQuantity ?? 0,
      taxMode: parsedData.taxMode,
      taxIncludedInPrice: (() => {
        const rates = [
          ...parsedData.lineItems.flatMap((line) => [
            line.taxRate,
            ...(line.perMethodTaxRate ?? []).map((entry) => entry.taxRate),
          ]),
          ...(parsedData.customLineItems ?? []).flatMap((line) => [
            line.taxRate,
            ...(line.perMethodTaxRate ?? []).map((entry) => entry.taxRate),
          ]),
          parsedData.shippingInfo?.taxRate,
          ...(parsedData.shipping ?? []).map(
            (entry) => entry.shippingInfo?.taxRate
          ),
        ].filter((rate) => rate !== null && rate !== undefined);
        return rates.length > 0 &&
          rates.every(
            (rate) => rate.includedInPrice === rates[0]?.includedInPrice
          )
          ? rates[0]?.includedInPrice
          : undefined;
      })(),
      taxedPrice:
        parsedData.taxedPrice === null || parsedData.taxedPrice === undefined
          ? null
          : {
              totalGross: {
                ...parsedData.taxedPrice.totalGross,
                currencyCode: decodeCurrencyCode(
                  parsedData.taxedPrice.totalGross.currencyCode
                ),
              },
              totalNet: {
                ...parsedData.taxedPrice.totalNet,
                currencyCode: decodeCurrencyCode(
                  parsedData.taxedPrice.totalNet.currencyCode
                ),
              },
              totalTax:
                parsedData.taxedPrice.totalTax === null ||
                parsedData.taxedPrice.totalTax === undefined
                  ? null
                  : {
                      ...parsedData.taxedPrice.totalTax,
                      currencyCode: decodeCurrencyCode(
                        parsedData.taxedPrice.totalTax.currencyCode
                      ),
                    },
            },
      totalPrice: {
        centAmount: parsedData.totalPrice.centAmount,
        currencyCode: parsedData.totalPrice.currencyCode,
      },
    };
    if (parsedData.businessUnit !== null) {
      cart.businessUnitId = CommerceBusinessUnitId.make(
        parsedData.businessUnit.id
      );
    }
    return cart;
  });

const decodeCommercetoolsCart = (
  fragment: FragmentOf<typeof CartFragment>,
  locale: string,
  operation: CartOperation
) =>
  toCommercetoolsCart(fragment, locale).pipe(
    Effect.mapError((cause) => providerFailure(operation, cause, "invalidData"))
  );

const taxForCart = (cart: CommercetoolsCart): CartTax => {
  if (cart.taxMode === "Disabled") {
    return {
      amount: { centAmount: 0, currencyCode: cart.totalPrice.currencyCode },
      includedInPrice: "no",
      status: "known",
    };
  }
  if (cart.taxedPrice === undefined || cart.taxedPrice === null) {
    return { status: "unknown" };
  }
  let includedInPrice: "yes" | "no" | "unknown" = "unknown";
  if (cart.taxIncludedInPrice !== undefined) {
    includedInPrice = cart.taxIncludedInPrice ? "yes" : "no";
  }
  return {
    amount: cart.taxedPrice.totalTax ?? {
      ...cart.taxedPrice.totalGross,
      centAmount:
        cart.taxedPrice.totalGross.centAmount -
        cart.taxedPrice.totalNet.centAmount,
    },
    includedInPrice,
    status: "known",
  };
};

export const toCart = (
  cart: CommercetoolsCart,
  operation: CartOperation
): Effect.Effect<CartSnapshot, CartProviderFailure> => {
  const lineItems: CartLineItemCandidate[] = cart.lineItems.map((lineItem) => {
    const discountedUnitPrice =
      cart.productDiscountsApplied === false
        ? undefined
        : lineItem.price.discounted?.value;
    const unitPrice = discountedUnitPrice ?? lineItem.price.value;
    const projectedLineItem: MutableCartLineItemCandidate = {
      discounts: lineItem.discounts,
      id: LineItemId.make(lineItem.id),
      quantity: lineItem.quantity,
      regularUnitPrice: discountedUnitPrice ? lineItem.price.value : undefined,
      subtotalPrice: {
        ...unitPrice,
        centAmount:
          lineItem.totalPrice === null
            ? unitPrice.centAmount * lineItem.quantity
            : lineItem.totalPrice.centAmount +
              (lineItem.discounts ?? [])
                .filter(({ target }) => target === "items")
                .reduce((sum, { amount }) => sum + amount.centAmount, 0),
      },
      unitPrice,
    };
    if (lineItem.totalPrice !== null) {
      projectedLineItem.totalPrice = lineItem.totalPrice;
    }
    if (lineItem.variant !== null) {
      const variant: MutableCartProductVariantCandidate = {
        id: variantReference(lineItem.productId, lineItem.variant.id),
        images: lineItem.variant.images,
        productId: ProductId.make(lineItem.productId),
      };
      if (lineItem.name !== null && lineItem.name !== undefined) {
        variant.name = lineItem.name;
      }
      if (lineItem.productType !== undefined) {
        variant.productType = lineItem.productType;
      }
      if (lineItem.variant.sku !== undefined) {
        variant.sku = Sku.make(lineItem.variant.sku);
      }
      if (lineItem.variant.summaryAttribute !== undefined) {
        variant.summaryAttribute = lineItem.variant.summaryAttribute;
      }
      projectedLineItem.variant = variant;
    }
    return projectedLineItem;
  });

  const value: MutableCartSnapshotCandidate = {
    checkoutDetails: cart.checkoutDetails ?? {},
    discountCodes: cart.discountCodes?.map(({ code, applicable }) => ({
      applicable,
      code,
    })),
    discounts: cart.discounts,
    id: CartId.make(cart.id),
    lineItems,
    status: cart.cartState === "Active" ? "active" : "inactive",
    subtotalPrice: {
      centAmount: lineItems.reduce(
        (sum, line) => sum + (line.subtotalPrice?.centAmount ?? 0),
        0
      ),
      currencyCode: cart.totalPrice.currencyCode,
    },
    totalLineItemQuantity: cart.totalLineItemQuantity,
    tax: taxForCart(cart),
    totalPrice: payableTotal(cart),
    totalPriceEstimated:
      (cart.taxMode !== "Disabled" &&
        (cart.taxedPrice === undefined || cart.taxedPrice === null)) ||
      cart.checkoutDetails?.selectedDeliveryPlan === undefined,
  };
  if (cart.customerId !== undefined) {
    value.customerId = CommerceCustomerId.make(cart.customerId);
  }
  if (cart.businessUnitId !== undefined) {
    value.buyingContext = { businessUnitId: cart.businessUnitId };
  }
  if (cart.store?.key !== null && cart.store?.key !== undefined) {
    value.storeKey = StoreKey.make(cart.store.key);
  }

  return Schema.decodeUnknownEffect(CartSnapshot)(value).pipe(
    Effect.mapError((cause) => providerFailure(operation, cause, "invalidData"))
  );
};

// ---------------------------------------------------------------------------
// Cart ownership
// ---------------------------------------------------------------------------

const targetScope = (target: CartTarget) => {
  if (target._tag === "AnonymousCartTarget") {
    return new StorefrontAnonymousCheckoutScope({
      anonymousCartId: target.id,
      channel: "storefrontAnonymous",
      locale: target.store.locale,
    });
  }
  if (target._tag === "CustomerCartTarget") {
    return new StorefrontB2CCheckoutScope({
      channel: "storefrontPersonal",
      customerId: target.customerId,
      locale: target.store.locale,
      storeKey: target.store.storeKey,
    });
  }
  return new StorefrontCustomerCheckoutScope({
    businessUnitId: target.businessUnitId,
    businessUnitKey: target.businessUnitKey,
    channel: "storefrontCustomer",
    customerId: target.customerId,
    locale: target.store.locale,
  });
};

const targetOwnsCart = (target: CartTarget, cart: CommercetoolsCart) => {
  if (
    cart.cartState !== "Active" ||
    cart.store?.key !== target.store.storeKey
  ) {
    return false;
  }

  if (target._tag === "AnonymousCartTarget") {
    return cart.businessUnitId === undefined && cart.customerId === undefined;
  }
  if (target._tag === "CustomerCartTarget") {
    return (
      cart.businessUnitId === undefined && cart.customerId === target.customerId
    );
  }
  return (
    cart.businessUnitId === target.businessUnitId &&
    (cart.customerId === undefined || cart.customerId === target.customerId)
  );
};

const activeCartForStorePredicate = (storeKey: string) =>
  `cartState="Active" and store(key=${JSON.stringify(storeKey)})`;

// ---------------------------------------------------------------------------
// Provider write plumbing
// ---------------------------------------------------------------------------

interface GraphqlVersionedWriteResult {
  readonly error?: unknown;
}

const executeVersionedGraphqlWrite = <
  Input,
  Result extends GraphqlVersionedWriteResult,
>({
  operation,
  input,
  execute,
  resolveConflict,
}: {
  readonly operation: string;
  readonly input: Input;
  readonly execute: (input: Input) => PromiseLike<Result>;
  readonly resolveConflict: (
    conflict: CommercetoolsConcurrentModification,
    input: Input
  ) => Effect.Effect<VersionedWriteConflictResolution<Input>>;
}) =>
  retryVersionedWrite({
    attempt: (current) =>
      commercetoolsRequest(
        `Failed to execute GraphQL mutation ${operation}`,
        () => execute(current)
      ).pipe(
        Effect.flatMap((result) =>
          result.error !== undefined && isConcurrentModification(result.error)
            ? Effect.fail(result.error)
            : Effect.succeed(result)
        )
      ),
    input,
    operation,
    resolveConflict,
  });

const retryWithProviderVersion = <Input extends { readonly version: number }>(
  currentVersion: number,
  input: Input
) =>
  Effect.succeed(
    new RetryVersionedWrite({
      ...input,
      version: currentVersion,
    })
  );

const canRetryCartUpdateWithCurrentVersion = (
  actions: readonly CartUpdateAction[]
) => actions.every((action) => action.action !== "setCustomType");

const executeCartUpdateAsAssociate = async (
  apiRoot: ByProjectKeyRequestBuilder,
  {
    actions,
    cartId,
    scope,
    version,
  }: {
    readonly actions: CartUpdateAction[];
    readonly cartId: string;
    readonly scope: StorefrontCustomerCheckoutScope;
    readonly version: number;
  }
) =>
  await apiRoot
    .asAssociate()
    .withAssociateIdValue({
      associateId: String(scope.customerId),
    })
    .inBusinessUnitKeyWithBusinessUnitKeyValue({
      businessUnitKey: String(scope.businessUnitKey),
    })
    .carts()
    .withId({ ID: cartId })
    .post({
      body: {
        actions,
        version,
      },
    })
    .execute();

const executeCartUpdate = async (
  apiRoot: ByProjectKeyRequestBuilder,
  {
    actions,
    cartId,
    version,
  }: {
    readonly actions: CartUpdateAction[];
    readonly cartId: string;
    readonly version: number;
  }
) =>
  await apiRoot
    .carts()
    .withId({ ID: cartId })
    .post({ body: { actions, version } })
    .execute();

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const cartsLayerFor = (shippingMode: "Single" | "Multiple") =>
  Layer.effect(
    Carts,
    Effect.gen(function* () {
      const client: GraphqlClient = yield* CommercetoolsGraphQLClient;
      const { apiRoot } = yield* CommercetoolsRestClient;

      const readRequest = <A>(
        operation: CartOperation,
        request: () => PromiseLike<A>
      ): Effect.Effect<A, CartProviderFailure> =>
        Effect.tryPromise({
          catch: (cause) => providerFailure(operation, cause, "unavailable"),
          try: async () => await request(),
        });

      const readCart = Effect.fn("Carts.readCart")(function* (
        cartId: CartId,
        locale: string,
        operation: CartOperation
      ) {
        const result = yield* readRequest(operation, () =>
          client.query(GetCartByIdQuery, { id: String(cartId), locale })
        );

        if (result.error !== undefined) {
          return yield* failedRead(operation, cartId, result.error);
        }

        if (result.data === undefined) {
          return yield* dieOnContractViolation(
            "Commercetools returned no data while finding a Cart"
          );
        }

        if (result.data.cart === null) {
          return yield* new CartNotFound({ cartId, operation });
        }

        const cart = yield* decodeCommercetoolsCart(
          result.data.cart,
          locale,
          operation
        );

        return cart;
      });

      const standardCartWrite = {
        anonymous: {
          message: "Failed to update Cart",
          operation: "cart.update",
        },
        associate: {
          message: "Failed to update Cart as associate",
          operation: "cart.updateAsAssociate",
        },
      } as const;
      const shippingCartWrite = {
        anonymous: {
          message: "Failed to save Shipping Options",
          operation: "cart.saveShippingOptions",
        },
        associate: {
          message: "Failed to save Shipping Options as associate",
          operation: "cart.saveShippingOptionsAsAssociate",
        },
      } as const;

      const writeTargetCart = <Failure>({
        actions,
        profile,
        projectFailure,
        retryConcurrentModification,
        target,
        version,
      }: {
        readonly actions: CartUpdateAction[];
        readonly profile: {
          readonly associate: {
            readonly message: string;
            readonly operation: string;
          };
          readonly anonymous: {
            readonly message: string;
            readonly operation: string;
          };
        };
        readonly projectFailure: (
          cause: unknown
        ) => Effect.Effect<never, Failure>;
        readonly retryConcurrentModification: boolean;
        readonly target: CartTarget;
        readonly version: number;
      }): Effect.Effect<void, Failure> =>
        retryVersionedWrite({
          attempt: (current) => {
            const scope = targetScope(current.target);
            const write =
              scope.channel === "storefrontCustomer"
                ? profile.associate
                : profile.anonymous;
            return commercetoolsRequest(write.message, async () => {
              if (scope.channel === "storefrontCustomer") {
                return await executeCartUpdateAsAssociate(apiRoot, {
                  actions: current.actions,
                  cartId: String(current.target.id),
                  scope,
                  version: current.version,
                });
              }
              return await executeCartUpdate(apiRoot, {
                actions: current.actions,
                cartId: String(current.target.id),
                version: current.version,
              });
            }).pipe(Effect.asVoid);
          },
          input: { actions, target, version },
          operation:
            targetScope(target).channel === "storefrontCustomer"
              ? profile.associate.operation
              : profile.anonymous.operation,
          resolveConflict: (conflict, current) =>
            Effect.succeed(
              retryConcurrentModification &&
                canRetryCartUpdateWithCurrentVersion(current.actions)
                ? new RetryVersionedWrite({
                    ...current,
                    version: conflict.currentVersion,
                  })
                : new PreserveVersionedWriteConflict()
            ),
        }).pipe(Effect.catch(projectFailure));

      const removeDeletedDiscountCodes = Effect.fn(
        "Carts.removeDeletedDiscountCodes"
      )(function* (
        cart: CommercetoolsCart,
        target: CartTarget,
        operation: CartOperation
      ) {
        const deletedIds = cart.deletedDiscountCodeIds ?? [];
        if (deletedIds.length === 0) {
          return cart;
        }
        if (!targetOwnsCart(target, cart)) {
          return yield* accessDenied(operation, target.id);
        }
        // A deleted code cannot be displayed or removed by code text. Reconcile
        // its native reference before exposing the selected Cart to checkout.
        yield* writeTargetCart({
          actions: [
            ...clearSelectedDeliveryPlanActions(cart),
            ...clearSelectedPaymentActions(cart),
            ...deletedIds.map(
              (id): CartUpdateAction => ({
                action: "removeDiscountCode",
                discountCode: { id, typeId: "discount-code" },
              })
            ),
          ],
          profile: standardCartWrite,
          projectFailure: (cause) => failedWrite(operation, target.id, cause),
          retryConcurrentModification: false,
          target,
          version: cart.version,
        }).pipe(
          // Another request may already have reconciled this Cart. Read its
          // result and verify it below without replaying stale update actions.
          Effect.catchTag("CartWriteConflict", () => Effect.void),
          Effect.mapError((error) =>
            error._tag === "CartAccessDenied"
              ? error
              : new CartProviderFailure({
                  cause: error,
                  operation,
                  reason: "unavailable",
                })
          )
        );
        const refreshed = yield* readCart(
          target.id,
          target.store.locale,
          operation
        ).pipe(
          Effect.catchTag(
            "CartNotFound",
            (cause) =>
              new CartProviderFailure({
                cause,
                operation,
                reason: "unavailable",
              })
          )
        );
        if (!targetOwnsCart(target, refreshed)) {
          return yield* accessDenied(operation, target.id);
        }
        if ((refreshed.deletedDiscountCodeIds?.length ?? 0) > 0) {
          return yield* new CartProviderFailure({
            operation,
            reason: "unavailable",
          });
        }
        return refreshed;
      });

      const loadTargetCart = Effect.fn("Carts.loadTargetCart")(function* (
        target: CartTarget,
        operation: CartOperation
      ) {
        const cart = yield* readCart(target.id, target.store.locale, operation);
        if (!targetOwnsCart(target, cart)) {
          return yield* accessDenied(operation, target.id);
        }
        return yield* removeDeletedDiscountCodes(cart, target, operation);
      });

      const updateTargetCartAndReload = Effect.fn(
        "Carts.updateTargetCartAndReload"
      )(function* (
        operation: CartOperation,
        target: CartTarget,
        actions: CartUpdateAction[],
        version: number
      ) {
        yield* writeTargetCart({
          actions,
          profile: standardCartWrite,
          projectFailure: (cause) => failedWrite(operation, target.id, cause),
          retryConcurrentModification: false,
          target,
          version,
        });
        return yield* loadTargetCart(target, operation);
      });

      const findById = Effect.fn("Carts.findById")(function* (
        input: FindCartById
      ) {
        const found = yield* readCart(
          input.id,
          input.store.locale,
          "findById"
        ).pipe(
          Effect.map(Option.some),
          Effect.catchTag("CartNotFound", () =>
            Effect.succeed(Option.none<CommercetoolsCart>())
          )
        );

        if (Option.isNone(found)) {
          return Option.none<CartSnapshot>();
        }

        const cart = found.value;

        if (
          cart.store?.key !== input.store.storeKey ||
          cart.businessUnitId !== undefined ||
          cart.customerId !== undefined
        ) {
          return yield* accessDenied("findById", input.id);
        }

        // An owned completed cart is no longer a current cart. CurrentCart clears
        // its cookie and creates a fresh cart on the next mutation.
        if (cart.cartState !== "Active") {
          return Option.none<CartSnapshot>();
        }

        const refreshed = yield* removeDeletedDiscountCodes(
          cart,
          {
            _tag: "AnonymousCartTarget",
            id: input.id,
            store: input.store,
          },
          "findById"
        );
        return Option.some(yield* toCart(refreshed, "findById"));
      });

      const findActiveForCustomer = Effect.fn("Carts.findActiveForCustomer")(
        function* (input: FindActiveCartsForCustomer) {
          const operation = "findActiveForCustomer" as const;
          const result = yield* readRequest(operation, () =>
            client.query(GetActiveCartsForCustomerQuery, {
              locale: input.store.locale,
              where: `${activeCartForStorePredicate(input.store.storeKey)} and customerId=${JSON.stringify(input.customerId)} and businessUnit is not defined`,
            })
          );
          if (result.error !== undefined) {
            return yield* failedRead(operation, undefined, result.error);
          }
          if (result.data === undefined) {
            return yield* dieOnContractViolation(
              "Commercetools returned no data while finding personal Carts"
            );
          }
          // oxlint-disable-next-line unicorn/no-array-method-this-argument -- This is Effect.forEach's iterable argument, not Array#forEach's thisArg.
          const carts = yield* Effect.forEach(
            result.data.carts.results,
            (cart) =>
              decodeCommercetoolsCart(cart, input.store.locale, operation)
          );
          return yield* Effect.forEach(
            carts,
            (
              cart
            ): Effect.Effect<
              CartSnapshot,
              CartAccessDenied | CartProviderFailure
            > => {
              const target: CartTarget = {
                _tag: "CustomerCartTarget",
                customerId: input.customerId,
                id: CartId.make(cart.id),
                store: input.store,
              };
              return targetOwnsCart(target, cart)
                ? removeDeletedDiscountCodes(cart, target, operation).pipe(
                    Effect.flatMap((refreshed) => toCart(refreshed, operation))
                  )
                : accessDenied(operation, target.id);
            }
          );
        }
      );

      const createForCustomer = Effect.fn("Carts.createForCustomer")(function* (
        input: CreateCustomerCart
      ) {
        const operation = "createForCustomer" as const;
        const response = yield* commercetoolsRequest(
          "Failed to create personal Cart",
          async () =>
            await apiRoot
              .carts()
              .post({
                body: {
                  currency: input.store.currency,
                  customerId: String(input.customerId),
                  shippingMode,
                  store: { key: String(input.store.storeKey), typeId: "store" },
                },
              })
              .execute()
        ).pipe(Effect.catch((error) => failedCreate(operation, error)));
        const cart = yield* readCart(
          CartId.make(response.body.id),
          input.store.locale,
          operation
        ).pipe(
          Effect.catch(() =>
            Effect.fail(
              writeOutcomeUnknown(operation, CartId.make(response.body.id))
            )
          )
        );
        const target: CartTarget = {
          _tag: "CustomerCartTarget",
          customerId: input.customerId,
          id: CartId.make(cart.id),
          store: input.store,
        };
        if (!targetOwnsCart(target, cart)) {
          return yield* accessDenied(operation, target.id);
        }
        return yield* toCart(cart, operation);
      });

      const findActiveForBusinessUnit = Effect.fn(
        "Carts.findActiveForBusinessUnit"
      )(function* (input: FindActiveCartsForBusinessUnit) {
        const operation: CartOperation = "findActiveForBusinessUnit";
        const result = yield* readRequest(operation, () =>
          client.query(GetActiveCartForBusinessUnitAsAssociateQuery, {
            associateId: input.customerId,
            businessUnitKey: input.businessUnitKey,
            locale: input.store.locale,
            where: activeCartForStorePredicate(input.store.storeKey),
          })
        );

        if (result.error !== undefined) {
          return yield* failedRead(operation, undefined, result.error);
        }

        if (result.data === undefined) {
          return yield* dieOnContractViolation(
            "Commercetools returned no data while finding active Carts"
          );
        }

        const carts = yield* Effect.forEach(
          // oxlint-disable-next-line unicorn/no-array-method-this-argument -- This is Effect.forEach's iterable argument, not Array#forEach's thisArg.
          result.data.asAssociate.carts.results,
          (cart) => decodeCommercetoolsCart(cart, input.store.locale, operation)
        );
        return yield* Effect.forEach(carts, (cart) =>
          removeDeletedDiscountCodes(
            cart,
            {
              _tag: "BusinessUnitCartTarget",
              businessUnitId: input.businessUnitId,
              businessUnitKey: input.businessUnitKey,
              customerId: input.customerId,
              id: CartId.make(cart.id),
              store: input.store,
            },
            operation
          ).pipe(Effect.flatMap((refreshed) => toCart(refreshed, operation)))
        );
      });

      const createAnonymous = Effect.fn("Carts.createAnonymous")(function* (
        input: CreateAnonymousCart
      ) {
        const operation = "createAnonymous" as const;
        const result = yield* Effect.tryPromise({
          catch: (cause) => cause,
          try: async () =>
            await client.mutation(CreateCartMutation, {
              currency: input.store.currency,
              locale: input.store.locale,
              shippingMode,
              storeKey: input.store.storeKey,
            }),
        }).pipe(Effect.catch((error) => failedCreate(operation, error)));

        if (result.error !== undefined) {
          return yield* failedMutation(operation, undefined, result.error);
        }

        if (!result.data?.createCart) {
          return yield* missingCartData(operation);
        }

        const cart = yield* decodeCommercetoolsCart(
          result.data.createCart,
          input.store.locale,
          operation
        );
        return yield* toCart(cart, operation);
      });

      const createForBusinessUnit = Effect.fn("Carts.createForBusinessUnit")(
        function* (input: CreateBusinessUnitCart) {
          const operation = "createForBusinessUnit" as const;
          const response = yield* commercetoolsRequest(
            "Failed to create Cart as associate",
            async () =>
              await apiRoot
                .asAssociate()
                .withAssociateIdValue({ associateId: String(input.customerId) })
                .inBusinessUnitKeyWithBusinessUnitKeyValue({
                  businessUnitKey: String(input.businessUnitKey),
                })
                .carts()
                .post({
                  body: {
                    currency: input.store.currency,
                    customerId: String(input.customerId),
                    shippingMode,
                    store: {
                      key: String(input.store.storeKey),
                      typeId: "store",
                    },
                  },
                })
                .execute()
          ).pipe(Effect.catch((error) => failedCreate(operation, error)));

          const cartId = CartId.make(response.body.id);
          const cart = yield* readCart(
            cartId,
            input.store.locale,
            operation
          ).pipe(
            Effect.catch(() =>
              Effect.fail(writeOutcomeUnknown(operation, cartId))
            )
          );

          return yield* toCart(cart, operation);
        }
      );

      const addItem = Effect.fn("Carts.addItem")(function* (
        input: AddCartItem
      ) {
        const operation: CartOperation = "addItem";
        const reference = resolveVariantReference(input.variantId);
        if (Option.isNone(reference)) {
          return yield* new CartMerchandiseUnavailable({
            variantId: input.variantId,
          });
        }
        const { productId, variantId } = reference.value;

        const cart = yield* loadTargetCart(input.target, operation);
        const store = yield* readRequest(operation, () =>
          client.query(CartDistributionChannelQuery, {
            storeKey: input.target.store.storeKey,
          })
        );

        if (store.error !== undefined) {
          return yield* failedRead(operation, input.target.id, store.error);
        }

        const distributionChannelKey =
          store.data?.store?.distributionChannels[0]?.key;
        if (
          store.data?.store?.distributionChannels.length !== 1 ||
          distributionChannelKey === undefined
        ) {
          return yield* dieOnContractViolation(
            `Commercetools Store ${String(input.target.store.storeKey)} must have exactly one distribution channel`
          );
        }

        const clearActions = [
          ...clearSelectedDeliveryPlanActions(cart),
          ...clearSelectedPaymentActions(cart),
        ];
        if (
          clearActions.length > 0 ||
          input.target._tag === "BusinessUnitCartTarget"
        ) {
          const actions: CartUpdateAction[] = [
            ...clearActions,
            {
              action: "addLineItem",
              distributionChannel: {
                key: distributionChannelKey,
                typeId: "channel",
              },
              productId: String(productId),
              quantity: input.quantity,
              variantId,
            },
          ];
          const refreshed = yield* updateTargetCartAndReload(
            operation,
            input.target,
            actions,
            cart.version
          );
          return yield* toCart(refreshed, operation);
        }

        const result = yield* executeVersionedGraphqlWrite({
          execute: (current) => client.mutation(AddItemToCartMutation, current),
          input: {
            distributionChannelKey,
            id: cart.id,
            locale: input.target.store.locale,
            productId: String(productId),
            quantity: input.quantity,
            variantId,
            version: cart.version,
          },
          operation: "cart.addLineItem",
          resolveConflict: (conflict, current) =>
            retryWithProviderVersion(conflict.currentVersion, current),
        }).pipe(
          Effect.catch((error) =>
            failedWrite(operation, input.target.id, error)
          )
        );

        if (result.error !== undefined) {
          if (
            hasCommercetoolsErrorCode(
              result.error,
              "InvalidInput",
              "MatchingPriceNotFound"
            )
          ) {
            return yield* new CartMerchandiseUnavailable({
              variantId: input.variantId,
            });
          }

          return yield* failedMutation(
            operation,
            input.target.id,
            result.error
          );
        }

        if (!result.data?.updateCart) {
          return yield* missingCartData(operation, input.target.id);
        }

        const updatedCart = yield* decodeCommercetoolsCart(
          result.data.updateCart,
          input.target.store.locale,
          operation
        );
        return yield* toCart(updatedCart, operation);
      });

      const setLineItemQuantity = Effect.fn("Carts.setLineItemQuantity")(
        function* (input: SetCartLineItemQuantity) {
          const operation: CartOperation = "setLineItemQuantity";
          const cart = yield* loadTargetCart(input.target, operation);

          if (
            !cart.lineItems.some((lineItem) => lineItem.id === input.lineItemId)
          ) {
            return yield* new CartLineItemNotFound({
              cartId: input.target.id,
              lineItemId: input.lineItemId,
              operation,
            });
          }

          const clearActions = [
            ...clearSelectedDeliveryPlanActions(cart),
            ...clearSelectedPaymentActions(cart),
          ];
          if (clearActions.length > 0) {
            const actions: CartUpdateAction[] = [
              ...clearActions,
              {
                action: "changeLineItemQuantity",
                lineItemId: String(input.lineItemId),
                quantity: input.quantity,
              },
            ];
            const refreshed = yield* updateTargetCartAndReload(
              operation,
              input.target,
              actions,
              cart.version
            );
            return yield* toCart(refreshed, operation);
          }

          const result = yield* executeVersionedGraphqlWrite({
            execute: (current) =>
              client.mutation(ChangeItemsQuantityMutation, current),
            input: {
              id: cart.id,
              lineItemId: String(input.lineItemId),
              locale: input.target.store.locale,
              quantity: input.quantity,
              version: cart.version,
            },
            operation: "cart.changeLineItemQuantity",
            resolveConflict: (conflict, current) =>
              retryWithProviderVersion(conflict.currentVersion, current),
          }).pipe(
            Effect.catch((error) =>
              failedWrite(operation, input.target.id, error)
            )
          );

          if (result.error !== undefined) {
            return yield* failedMutation(
              operation,
              input.target.id,
              result.error
            );
          }

          if (!result.data?.updateCart) {
            return yield* missingCartData(operation, input.target.id);
          }

          const updatedCart = yield* decodeCommercetoolsCart(
            result.data.updateCart,
            input.target.store.locale,
            operation
          );
          return yield* toCart(updatedCart, operation);
        }
      );

      const removeLineItem = Effect.fn("Carts.removeLineItem")(function* (
        input: RemoveCartLineItem
      ) {
        const operation: CartOperation = "removeLineItem";
        const cart = yield* loadTargetCart(input.target, operation);

        if (
          !cart.lineItems.some((lineItem) => lineItem.id === input.lineItemId)
        ) {
          return yield* new CartLineItemNotFound({
            cartId: input.target.id,
            lineItemId: input.lineItemId,
            operation,
          });
        }

        const clearActions = [
          ...clearSelectedDeliveryPlanActions(cart),
          ...clearSelectedPaymentActions(cart),
        ];
        if (clearActions.length > 0) {
          const actions: CartUpdateAction[] = [
            ...clearActions,
            {
              action: "removeLineItem",
              lineItemId: String(input.lineItemId),
            },
          ];
          const refreshed = yield* updateTargetCartAndReload(
            operation,
            input.target,
            actions,
            cart.version
          );
          return yield* toCart(refreshed, operation);
        }

        const result = yield* executeVersionedGraphqlWrite({
          execute: (current) =>
            client.mutation(RemoveItemFromCartMutation, current),
          input: {
            id: cart.id,
            lineItemId: String(input.lineItemId),
            locale: input.target.store.locale,
            version: cart.version,
          },
          operation: "cart.removeLineItem",
          resolveConflict: (conflict, current) =>
            retryWithProviderVersion(conflict.currentVersion, current),
        }).pipe(
          Effect.catch((error) =>
            failedWrite(operation, input.target.id, error)
          )
        );

        if (result.error !== undefined) {
          return yield* failedMutation(
            operation,
            input.target.id,
            result.error
          );
        }

        if (!result.data?.updateCart) {
          return yield* missingCartData(operation, input.target.id);
        }

        const updatedCart = yield* decodeCommercetoolsCart(
          result.data.updateCart,
          input.target.store.locale,
          operation
        );
        return yield* toCart(updatedCart, operation);
      });

      const writeCheckoutContact = (
        cart: CommercetoolsCart,
        input: SaveCartContact,
        retryConcurrentModification: boolean
      ) =>
        Effect.gen(function* () {
          const operation: CartOperation = "saveContact";
          const scope = targetScope(input.target);
          const customFieldsUpdate = buildSaveCheckoutContactUpdate(
            cart,
            input.contact
          );

          if (scope.channel === "storefrontCustomer") {
            const customFieldActions =
              yield* customFieldsUpdate.toRestUpdateActions();
            const restActions: CartUpdateAction[] = [
              {
                action: "setCustomerEmail",
                email: input.contact.buyerContact.email,
              },
              ...customFieldActions,
            ];

            return yield* writeTargetCart({
              actions: restActions,
              profile: standardCartWrite,
              projectFailure: (cause) =>
                failedWrite(operation, input.target.id, cause),
              retryConcurrentModification,
              target: input.target,
              version: cart.version,
            });
          }

          const customFieldActions =
            yield* customFieldsUpdate.toGraphqlUpdateActions();
          const actions = [
            {
              setCustomerEmail: {
                email: input.contact.buyerContact.email,
              },
            },
            ...customFieldActions,
          ];
          const result = yield* executeVersionedGraphqlWrite({
            execute: (current) =>
              client.mutation(SaveCheckoutContactMutation, current),
            input: {
              actions,
              id: cart.id,
              locale: input.target.store.locale,
              version: cart.version,
            },
            operation: "checkout.contact.save",
            resolveConflict: (conflict, current) =>
              retryConcurrentModification &&
              cart.custom?.type?.key === ORDER_CUSTOM_TYPE_KEY
                ? retryWithProviderVersion(conflict.currentVersion, current)
                : Effect.succeed(new PreserveVersionedWriteConflict()),
          }).pipe(
            Effect.catch((error) =>
              failedWrite(operation, input.target.id, error)
            )
          );

          if (result.error !== undefined) {
            return yield* failedMutation(
              operation,
              input.target.id,
              result.error
            );
          }

          if (!result.data?.updateCart) {
            return yield* missingCartData(operation, input.target.id);
          }
        });

      const saveContact = Effect.fn("Carts.saveContact")(function* (
        input: SaveCartContact
      ) {
        const operation: CartOperation = "saveContact";
        let cart = yield* loadTargetCart(input.target, operation);

        if (hasPersistedCheckoutContact(cart, input.contact)) {
          return yield* toCart(cart, operation);
        }

        let result = yield* Effect.result(
          writeCheckoutContact(cart, input, true)
        );

        if (
          result._tag === "Failure" &&
          result.failure._tag === "CartWriteConflict"
        ) {
          // A Cart that already carries the Order custom type cannot resolve the
          // conflict by re-reading: the competing write owns the same field.
          if (cart.custom?.type?.key === ORDER_CUSTOM_TYPE_KEY) {
            return yield* new CartWriteConflict({
              cartId: input.target.id,
              operation,
            });
          }

          cart = yield* loadTargetCart(input.target, operation);

          if (hasPersistedCheckoutContact(cart, input.contact)) {
            return yield* toCart(cart, operation);
          }

          result = yield* Effect.result(
            writeCheckoutContact(cart, input, false)
          );
        }

        if (result._tag === "Failure") {
          return yield* result.failure;
        }

        const refreshed = yield* loadTargetCart(input.target, operation);
        return yield* toCart(refreshed, operation);
      });

      const saveDeliveryDetails = Effect.fn("Carts.saveDeliveryDetails")(
        function* (input: SaveCartDeliveryDetails) {
          const operation: CartOperation = "saveDeliveryDetails";
          const cart = yield* loadTargetCart(input.target, operation);
          const scope = targetScope(input.target);
          const clearActions = [
            ...clearSelectedDeliveryPlanActions(cart),
            ...clearSelectedPaymentActions(cart),
          ];
          const customFieldsUpdate = buildSaveCheckoutDeliveryDetailsUpdate(
            cart,
            input.deliveryDetails
          );

          const useRestUpdate =
            scope.channel === "storefrontCustomer" || clearActions.length > 0;
          if (useRestUpdate) {
            const customFieldActions =
              yield* customFieldsUpdate.toRestUpdateActions();
            yield* writeTargetCart({
              actions: [...clearActions, ...customFieldActions],
              profile: standardCartWrite,
              projectFailure: (cause) =>
                failedWrite(operation, input.target.id, cause),
              retryConcurrentModification:
                scope.channel === "storefrontCustomer" &&
                clearActions.length === 0,
              target: input.target,
              version: cart.version,
            });
          } else {
            const customFieldActions =
              yield* customFieldsUpdate.toGraphqlUpdateActions();
            const result = yield* executeVersionedGraphqlWrite({
              execute: (current) =>
                client.mutation(SaveCheckoutDeliveryDetailsMutation, current),
              input: {
                actions: customFieldActions,
                id: cart.id,
                locale: input.target.store.locale,
                version: cart.version,
              },
              operation: "checkout.deliveryDetails.save",
              resolveConflict: (conflict, current) =>
                retryWithProviderVersion(conflict.currentVersion, current),
            }).pipe(
              Effect.catch((error) =>
                failedWrite(operation, input.target.id, error)
              )
            );

            if (result.error !== undefined) {
              return yield* failedMutation(
                operation,
                input.target.id,
                result.error
              );
            }

            if (!result.data?.updateCart) {
              return yield* missingCartData(operation, input.target.id);
            }
          }

          const refreshed = yield* loadTargetCart(input.target, operation);
          return yield* toCart(refreshed, operation);
        }
      );

      const saveShippingOptions = Effect.fn("Carts.saveShippingOptions")(
        function* (input: SaveCartShippingOptions) {
          const operation: CartOperation = "saveShippingOptions";
          const cart = yield* loadTargetCart(input.target, operation);

          const actions = [
            ...clearSelectedPaymentActions(cart),
            ...buildSaveShippingOptionsActions(
              cart,
              input.selectedDeliveryPlan
            ),
          ];
          yield* writeTargetCart({
            actions,
            profile: shippingCartWrite,
            projectFailure: (cause) =>
              failedShippingWrite(input.target.id, cause),
            retryConcurrentModification: false,
            target: input.target,
            version: cart.version,
          });

          return yield* loadTargetCart(input.target, operation).pipe(
            Effect.flatMap((refreshed) => toCart(refreshed, operation)),
            Effect.mapError(
              () =>
                new CartShippingOptionsRefreshRequired({
                  cartId: input.target.id,
                  operation,
                })
            )
          );
        }
      );

      const savePaymentOptions = Effect.fn("Carts.savePaymentOptions")(
        function* (input: SaveCartPaymentOptions) {
          const operation: CartOperation = "savePaymentOptions";
          const cart = yield* loadTargetCart(input.target, operation);
          const actions = buildSavePaymentOptionsActions(
            cart,
            input.preparedPayment
          );

          yield* writeTargetCart({
            actions: [...actions],
            profile: standardCartWrite,
            projectFailure: (cause) =>
              failedWrite(operation, input.target.id, cause),
            retryConcurrentModification: false,
            target: input.target,
            version: cart.version,
          });

          const refreshed = yield* loadTargetCart(input.target, operation);
          return yield* toCart(refreshed, operation);
        }
      );

      const clearPaymentOptions = Effect.fn("Carts.clearPaymentOptions")(
        function* (input: ClearCartPaymentOptions) {
          const operation: CartOperation = "clearPaymentOptions";
          const cart = yield* loadTargetCart(input.target, operation);
          const actions = clearSelectedPaymentActions(cart);
          if (actions.length > 0) {
            yield* writeTargetCart({
              actions,
              profile: standardCartWrite,
              projectFailure: (cause) =>
                failedWrite(operation, input.target.id, cause),
              retryConcurrentModification: false,
              target: input.target,
              version: cart.version,
            });
          }
          const refreshed = yield* loadTargetCart(input.target, operation);
          return yield* toCart(refreshed, operation);
        }
      );

      const changeDiscountCode = Effect.fn("Carts.changeDiscountCode")(
        function* (input: ChangeCartDiscountCode) {
          const operation = "changeDiscountCode" as const;
          const cart = yield* loadTargetCart(input.target, operation);
          const existing = cart.discountCodes?.find(
            ({ code }) => code === input.code
          );
          if (
            (input.action === "remove" && !existing) ||
            (input.action === "add" && existing)
          ) {
            return yield* toCart(cart, operation);
          }
          const actions: CartUpdateAction[] = [
            ...clearSelectedDeliveryPlanActions(cart),
            ...clearSelectedPaymentActions(cart),
          ];
          if (input.action === "add") {
            actions.push({ action: "addDiscountCode", code: input.code });
          } else if (existing) {
            actions.push({
              action: "removeDiscountCode",
              discountCode: { id: existing.id, typeId: "discount-code" },
            });
          }
          yield* writeTargetCart({
            actions,
            profile: standardCartWrite,
            projectFailure: (
              cause
            ): Effect.Effect<never, ChangeCartDiscountCodeFailure> =>
              hasCommercetoolsErrorCode(
                commercetoolsFailureCause(cause),
                "DiscountCodeNonApplicable",
                "InvalidInput",
                "InvalidOperation",
                "ReferencedResourceNotFound"
              )
                ? Effect.fail(
                    cartMutationRejected({
                      cartId: input.target.id,
                      message:
                        "This discount code cannot be applied to the cart.",
                      operation,
                    })
                  )
                : failedWrite(operation, input.target.id, cause),
            retryConcurrentModification: false,
            target: input.target,
            version: cart.version,
          });
          return yield* toCart(
            yield* loadTargetCart(input.target, operation),
            operation
          );
        }
      );

      return Carts.of({
        addItem,
        changeDiscountCode,
        clearPaymentOptions,
        createAnonymous,
        createForBusinessUnit,
        createForCustomer,
        findActiveForBusinessUnit,
        findActiveForCustomer,
        findById,
        removeLineItem,
        saveContact,
        saveDeliveryDetails,
        savePaymentOptions,
        saveShippingOptions,
        setLineItemQuantity,
      });
    })
  );

/** Provider configuration selected by the application checkout recipe. */
export const cartsLayer = cartsLayerFor("Multiple");
export const checkoutCartsLayer = cartsLayerFor("Single");
