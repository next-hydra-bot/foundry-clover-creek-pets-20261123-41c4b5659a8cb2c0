import { installedContentModel } from "@repo/cms-core";
import { defaultContent } from "@repo/cms-core/default-content";
import { describe, expect, it } from "vitest";

import { contentstackBlocks } from "./destination";
import { localizedBlockMetadata } from "./localized-blocks";
import { richTextContentstack } from "./rich-text";

describe("Contentstack portable blocks", () => {
  it("maps links and rich text and leaves the Contentstack category field to editors", () => {
    const profile = defaultContent(installedContentModel(true));
    const page = profile.entries.find((entry) => entry.type === "page")!;
    if (page.type !== "page") {
      throw new Error("Expected page");
    }
    const blocks = contentstackBlocks(
      {
        ...page,
        blocks: [
          ...page.blocks,
          {
            body: [
              { children: [{ text: "Wholesale supplies" }], type: "paragraph" },
            ],
            key: "copy",
            type: "rich-text",
          },
          {
            key: "drinks",
            limit: 3,
            title: "Drinks",
            type: "product-collection",
          },
        ],
      },
      profile,
      { assets: {}, categories: { drinks: "native-category" } }
    );
    expect(blocks).toMatchObject([
      {
        hero_section: {
          cta: [
            { external_url: "/resources/preventive-maintenance-checklist" },
          ],
        },
      },
      {
        rich_text: {
          body: {
            children: [
              { children: [{ text: "Wholesale supplies" }], type: "p" },
            ],
            type: "doc",
          },
        },
      },
      {
        dynamic_product_collection: {
          heading: "Drinks",
          limit: 3,
        },
      },
    ]);
    expect(blocks[2]?.dynamic_product_collection).not.toHaveProperty(
      "product_category"
    );
  });
});

it("keeps rich-text node IDs stable across updates and writes an empty paragraph when needed", () => {
  const empty = richTextContentstack([], "page:hero");
  const edited = richTextContentstack(
    [{ type: "paragraph", children: [{ text: "New copy" }] }],
    "page:hero"
  );
  expect(empty).toMatchObject({
    attrs: {},
    children: [{ attrs: {}, children: [{ text: "" }], type: "p" }],
    type: "doc",
    uid: edited.uid,
  });
  expect(empty.children[0]?.uid).toBe(edited.children[0]?.uid);
  expect(richTextContentstack([], "page:other").uid).not.toBe(empty.uid);
});

describe("Localized modular-block contract", () => {
  it("preserves the master UID and only copies inheritance when the stack returns it", () => {
    const fromMaster = { uid: "master-product-block" };
    expect(localizedBlockMetadata(fromMaster)).toEqual(fromMaster);
    const legacy = { ...fromMaster, non_localizable_content: true };
    expect(localizedBlockMetadata(legacy)).toEqual(legacy);
  });
});
