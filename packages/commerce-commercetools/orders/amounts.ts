import type {
  Order,
  ShippingInfo,
  TypedMoney,
} from "@commercetools/platform-sdk";

/** A multiplier keeps quantities and subtraction exact without overflowing a native number. */
type MoneyTerm = readonly [money: TypedMoney, multiplier: number];
const nativeAmount = (money: TypedMoney) => {
  const value =
    money.type === "highPrecision" ? money.preciseAmount : money.centAmount;
  const digits = money.fractionDigits;
  if (
    !Number.isSafeInteger(value) ||
    !Number.isSafeInteger(digits) ||
    digits < 0 ||
    digits > 20
  ) {
    throw new Error("Invalid native order amount or scale");
  }
  return { units: BigInt(value), digits, currencyCode: money.currencyCode };
};
const decimal = (units: bigint, digits: number) => {
  const unsigned = (units < 0n ? -units : units)
    .toString()
    .padStart(digits + 1, "0");
  const amount =
    digits === 0
      ? unsigned
      : `${unsigned.slice(0, -digits)}.${unsigned.slice(-digits)}`;
  return `${units < 0n ? "-" : ""}${amount}`;
};
/** Exact conversion retains high precision and zero-decimal currencies. */
export const orderMoney = (money: TypedMoney) => {
  const value = nativeAmount(money);
  return {
    amount: decimal(value.units, value.digits),
    currencyCode: value.currencyCode,
  };
};
const sum = (terms: readonly MoneyTerm[], basis: TypedMoney) => {
  const template = nativeAmount(basis);
  const values = terms.map(([money, multiplier]) => {
    const value = nativeAmount(money);
    if (
      value.currencyCode !== template.currencyCode ||
      !Number.isSafeInteger(multiplier)
    ) {
      throw new Error(
        "Order amounts have incompatible currencies or quantities"
      );
    }
    return { ...value, units: value.units * BigInt(multiplier) };
  });
  const digits = Math.max(
    template.digits,
    ...values.map((value) => value.digits)
  );
  const units = values.reduce(
    (total, value) =>
      total + value.units * 10n ** BigInt(digits - value.digits),
    0n
  );
  return {
    amount: decimal(units, digits),
    currencyCode: template.currencyCode,
  };
};
export const orderShipping = (order: Order): readonly ShippingInfo[] => {
  if (order.shippingMode === "Multiple") {
    return (order.shipping ?? []).map((shipping) => shipping.shippingInfo);
  }
  return order.shippingInfo ? [order.shippingInfo] : [];
};
const taxTreatment = (
  items: readonly { readonly taxRate?: { readonly includedInPrice: boolean } }[]
) => {
  if (
    items.length > 0 &&
    items.every((item) => item.taxRate?.includedInPrice === true)
  ) {
    return "yes" as const;
  }
  if (
    items.length > 0 &&
    items.every((item) => item.taxRate?.includedInPrice === false)
  ) {
    return "no" as const;
  }
  return "unknown" as const;
};
const discounts = (order: Order, shipping: readonly ShippingInfo[]) => {
  const terms: MoneyTerm[] = [];
  const productDiscounts =
    order.discountTypeCombination?.type !== "BestDeal" ||
    order.discountTypeCombination.chosenDiscountType !== "CartDiscount";
  for (const line of order.lineItems) {
    if (
      productDiscounts &&
      line.priceMode !== "ExternalTotal" &&
      line.price?.discounted
    ) {
      terms.push(
        [line.price.value, line.quantity],
        [line.price.discounted.value, -line.quantity]
      );
    }
  }
  for (const line of [...order.lineItems, ...order.customLineItems]) {
    for (const group of line.discountedPricePerQuantity ?? []) {
      for (const portion of group.discountedPrice.includedDiscounts) {
        terms.push([portion.discountedAmount, group.quantity]);
      }
    }
  }
  for (const info of shipping) {
    for (const portion of info.discountedPrice?.includedDiscounts ?? []) {
      terms.push([portion.discountedAmount, 1]);
    }
  }
  if (order.discountOnTotalPrice) {
    terms.push([order.discountOnTotalPrice.discountedAmount, 1]);
  }
  return terms.length > 0 ? sum(terms, order.totalPrice) : undefined;
};
const paymentAmounts = (order: Order) => {
  const references = order.paymentInfo?.payments ?? [];
  // A deleted/unexpanded Payment does not establish a zero collection or refund.
  if (
    references.length === 0 ||
    references.some(
      (reference) => !reference.obj || reference.obj.id !== reference.id
    )
  ) {
    return {};
  }
  const payments = references.flatMap((reference) =>
    reference.obj ? [reference.obj] : []
  );
  const successful = payments
    .flatMap((payment) => payment.transactions)
    .filter((transaction) => transaction.state === "Success");
  if (
    successful.some(
      (transaction) =>
        transaction.amount.currencyCode !== order.totalPrice.currencyCode ||
        transaction.type === "Chargeback"
    )
  ) {
    return {};
  }
  const charges = successful.filter(
    (transaction) => transaction.type === "Charge"
  );
  const refunds = successful.filter(
    (transaction) => transaction.type === "Refund"
  );
  const paidBeforeRefunds = sum(
    charges.map((transaction) => [transaction.amount, 1]),
    order.totalPrice
  );
  const refunded = sum(
    refunds.map((transaction) => [transaction.amount, 1]),
    order.totalPrice
  );
  const remaining = sum(
    [
      [order.taxedPrice?.totalGross ?? order.totalPrice, 1],
      ...charges.map((transaction): MoneyTerm => [transaction.amount, -1]),
    ],
    order.totalPrice
  );
  let outstanding;
  if (order.paymentState === "Paid" || order.paymentState === "CreditOwed") {
    outstanding = sum([], order.totalPrice);
  } else if (refunds.length === 0 && !remaining.amount.startsWith("-")) {
    outstanding = remaining;
  }
  // Refunds do not establish a new debt: the Order and return/credit records can differ.
  return { paidBeforeRefunds, refunded, outstanding };
};

const shippingNetTerms = (
  order: Order,
  shipping: readonly ShippingInfo[]
): readonly MoneyTerm[] | undefined => {
  if (order.taxedShippingPrice) {
    return [[order.taxedShippingPrice.totalNet, 1]];
  }
  if (shipping.length === 0) {
    return [];
  }
  if (
    !order.discountOnTotalPrice &&
    shipping.every((info) => info.taxedPrice)
  ) {
    return shipping.flatMap((info): MoneyTerm[] =>
      info.taxedPrice ? [[info.taxedPrice.totalNet, 1]] : []
    );
  }
  return undefined;
};

/** The current native total is authoritative; additional observations never reprice an Order. */
export const orderAmounts = (order: Order) => {
  const shipping = orderShipping(order);
  const lines = [...order.lineItems, ...order.customLineItems];
  const netShipping = shippingNetTerms(order, shipping);
  const shippingAmount =
    order.taxedPrice && netShipping
      ? {
          money: sum(netShipping, order.totalPrice),
          taxIncluded: "no" as const,
        }
      : {
          money: sum(
            shipping.map((info) => [
              info.discountedPrice?.value ?? info.price,
              1,
            ]),
            order.totalPrice
          ),
          taxIncluded: taxTreatment(shipping),
        };
  let subtotal;
  if (order.taxedPrice) {
    if (netShipping) {
      subtotal = {
        money: sum(
          [
            [order.taxedPrice.totalNet, 1],
            ...netShipping.map(
              ([money, multiplier]): MoneyTerm => [money, -multiplier]
            ),
          ],
          order.totalPrice
        ),
        taxIncluded: "no" as const,
      };
    }
  } else if (!order.discountOnTotalPrice || shipping.length === 0) {
    subtotal = {
      money: sum(
        order.discountOnTotalPrice
          ? [[order.totalPrice, 1]]
          : lines.map((line) => [line.totalPrice, 1]),
        order.totalPrice
      ),
      taxIncluded: taxTreatment(lines),
    };
  }
  return {
    subtotal,
    shipping:
      shipping.length > 0 || order.taxedShippingPrice
        ? shippingAmount
        : undefined,
    tax: order.taxedPrice?.totalTax
      ? orderMoney(order.taxedPrice.totalTax)
      : undefined,
    discounts: discounts(order, shipping),
    ...paymentAmounts(order),
  };
};
