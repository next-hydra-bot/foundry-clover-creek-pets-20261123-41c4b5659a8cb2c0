import { graphql } from "../../graphql";
import { productPriceFragment } from "../price";

export const CartFragment = graphql(
  `
    fragment CartFields on Cart {
      id
      version
      taxMode
      taxedPrice {
        totalGross {
          centAmount
          currencyCode
        }
        totalNet {
          centAmount
          currencyCode
        }
        totalTax {
          centAmount
          currencyCode
        }
      }
      customLineItems {
        taxRate {
          includedInPrice
        }
        perMethodTaxRate {
          taxRate {
            includedInPrice
          }
        }
      }
      discountTypeCombination {
        __typename
        ... on BestDeal {
          chosenDiscountType
        }
      }
      discountCodes {
        state
        discountCodeRef {
          id
        }
        discountCode {
          code
        }
      }
      discountOnTotalPrice {
        includedDiscounts {
          discountRef {
            id
          }
          discount {
            name(locale: $locale)
          }
          discountedAmount {
            centAmount
            currencyCode
          }
        }
      }
      shippingInfo {
        taxRate {
          includedInPrice
        }
        discountedPrice {
          includedDiscounts {
            discountRef {
              id
            }
            discount {
              name(locale: $locale)
            }
            discountedAmount {
              centAmount
              currencyCode
            }
          }
        }
      }
      shippingMode
      country
      customerId
      customerEmail
      shippingAddress {
        key
        streetName
        streetNumber
        postalCode
        city
        country
        additionalStreetInfo
        region
        state
      }
      billingAddress {
        key
        streetName
        streetNumber
        postalCode
        city
        country
        additionalStreetInfo
        region
        state
      }
      itemShippingAddresses {
        key
        streetName
        streetNumber
        postalCode
        city
        country
        additionalStreetInfo
        region
        state
      }
      shipping {
        shippingKey
        shippingAddress {
          key
          streetName
          streetNumber
          postalCode
          city
          country
          additionalStreetInfo
          region
          state
        }
        shippingInfo {
          taxRate {
            includedInPrice
          }
          discountedPrice {
            includedDiscounts {
              discountRef {
                id
              }
              discount {
                name(locale: $locale)
              }
              discountedAmount {
                centAmount
                currencyCode
              }
            }
          }
          shippingMethodName
          shippingMethodState
          shippingMethodRef {
            id
          }
          price {
            currencyCode
            centAmount
          }
        }
      }
      store {
        key
      }
      businessUnit {
        id
      }
      paymentInfo {
        paymentRefs {
          id
        }
        payments {
          id
          key
          amountPlanned {
            currencyCode
            centAmount
          }
          interfaceId
          paymentMethodInfo {
            method
            paymentInterface
          }
          custom {
            type {
              key
            }
            customFieldsRaw {
              name
              value
            }
          }
        }
      }
      custom {
        type {
          key
        }
        customFieldsRaw {
          name
          value
        }
      }
      lineItems {
        taxRate {
          includedInPrice
        }
        perMethodTaxRate {
          taxRate {
            includedInPrice
          }
        }
        discountedPricePerQuantity {
          quantity
          discountedPrice {
            includedDiscounts {
              discountRef {
                id
              }
              discount {
                name(locale: $locale)
              }
              discountedAmount {
                centAmount
                currencyCode
              }
            }
          }
        }
        distributionChannel {
          id
        }
        id
        key
        productId
        productType {
          key
          attributeDefinitions(limit: 500) {
            results {
              name
              labelAllLocales {
                locale
                value
              }
            }
          }
        }
        name(locale: $locale)
        quantity
        variant {
          id
          sku
          attributesRaw {
            name
            value
          }
          images {
            url
            label
          }
        }
        price {
          ...ProductPrice
        }
        totalPrice {
          currencyCode
          centAmount
        }
        shippingDetails {
          targets {
            addressKey
            quantity
            shippingMethodKey
          }
          valid
        }
      }
      totalLineItemQuantity
      totalPrice {
        currencyCode
        centAmount
      }
      version
      cartState
    }
  `,
  [productPriceFragment]
);
