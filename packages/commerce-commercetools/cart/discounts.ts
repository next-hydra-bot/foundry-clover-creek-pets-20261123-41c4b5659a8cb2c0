import type { CartDiscount } from "@repo/commerce-core/domain/promotions";

interface NativeDiscountPortion {
  readonly discount: { readonly name: string | null } | null;
  readonly discountRef: { readonly id: string };
  readonly discountedAmount: {
    readonly centAmount: number;
    readonly currencyCode: string;
  };
}

export const discountPortions = (
  portions: readonly NativeDiscountPortion[],
  target: CartDiscount["target"],
  quantity = 1
): readonly CartDiscount[] =>
  portions
    .map((portion) => ({
      amount: {
        ...portion.discountedAmount,
        centAmount: portion.discountedAmount.centAmount * quantity,
      },
      label: portion.discount?.name ?? undefined,
      reference: portion.discountRef.id,
      target,
    }))
    .filter(({ amount }) => amount.centAmount > 0);

export const aggregateDiscounts = (
  discounts: readonly CartDiscount[]
): readonly CartDiscount[] => {
  const grouped = new Map<string, CartDiscount>();
  for (const discount of discounts) {
    const key = `${discount.target}/${discount.reference}`;
    const previous = grouped.get(key);
    if (
      previous &&
      previous.amount.currencyCode !== discount.amount.currencyCode
    ) {
      throw new Error(
        "Commercetools discount allocations use different currencies"
      );
    }
    grouped.set(
      key,
      previous
        ? {
            ...discount,
            amount: {
              ...discount.amount,
              centAmount:
                previous.amount.centAmount + discount.amount.centAmount,
            },
          }
        : discount
    );
  }
  return [...grouped.values()];
};
