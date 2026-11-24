import { graphql, readFragment } from "../graphql";
import type { FragmentOf } from "../graphql";

/** Native totalPrice follows price tax treatment; totalGross is the amount payable. */
export const payableTotal = <Money>(resource: {
  readonly totalPrice: Money;
  readonly taxedPrice?: { readonly totalGross: Money } | null;
}): Money => resource.taxedPrice?.totalGross ?? resource.totalPrice;

export const productPriceSearchFragment = graphql(`
  fragment ProductPriceSearch on ProductPriceSearch {
    value {
      centAmount
      currencyCode
    }
    discounted {
      value {
        centAmount
        currencyCode
      }
    }
  }
`);

export const productPriceFragment = graphql(`
  fragment ProductPrice on ProductPrice {
    customerGroup {
      id
    }
    value {
      centAmount
      currencyCode
    }
    discounted {
      value {
        centAmount
        currencyCode
      }
    }
  }
`);

export const toSearchPrice = (
  data: FragmentOf<typeof productPriceSearchFragment>
) => {
  const price = readFragment(productPriceSearchFragment, data);
  return {
    ...price,
    discounted:
      price.discounted === null
        ? null
        : {
            ...price.discounted,
            value: {
              ...price.discounted.value,
              currencyCode: price.discounted.value.currencyCode,
            },
          },
    value: {
      ...price.value,
      currencyCode: price.value.currencyCode,
    },
  };
};

export const toCartPrice = (data: FragmentOf<typeof productPriceFragment>) => {
  const price = readFragment(productPriceFragment, data);
  return {
    ...price,
    discounted:
      price.discounted === null
        ? null
        : {
            ...price.discounted,
            value: {
              ...price.discounted.value,
              currencyCode: price.discounted.value.currencyCode,
            },
          },
    value: {
      ...price.value,
      currencyCode: price.value.currencyCode,
    },
  };
};
