import { NextIntlClientProvider } from "@repo/i18n";
import { getMessageCatalog } from "@repo/i18n/catalog";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductDetail } from "./product-detail";

const messages = getMessageCatalog("en-US");

describe(ProductDetail, () => {
  it("renders product content and dialog slots without commerce state", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
        <ProductDetail
          title="Test product"
          categoryName="Equipment"
          dialogs={<aside>Custom enquiry</aside>}
        >
          <button type="button">Custom purchase controls</button>
        </ProductDetail>
      </NextIntlClientProvider>
    );

    expect(markup).toContain("Equipment");
    expect(markup).toContain("Test product");
    expect(markup).toContain("Custom purchase controls");
    expect(markup).toContain("Custom enquiry");
  });
});
