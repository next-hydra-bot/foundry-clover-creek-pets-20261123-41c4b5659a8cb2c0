import { createHash } from "node:crypto";

import type { RichText } from "@repo/cms-core";

export function richTextContentstack(body: RichText, key: string) {
  const uid = (node: string) =>
    createHash("sha256").update(`${key}:${node}`).digest("hex").slice(0, 16);
  const children = body.map((block, index) => ({
    attrs: {},
    children: block.children.map((span) => ({
      text: span.text,
      ...(span.marks?.includes("bold") ? { bold: true } : {}),
      ...(span.marks?.includes("italic") ? { italic: true } : {}),
    })),
    type: block.type === "heading" ? `h${block.level ?? 2}` : "p",
    uid: uid(`block:${index}`),
  }));
  return {
    attrs: {},
    children: children.length
      ? children
      : [
          {
            attrs: {},
            children: [{ text: "" }],
            type: "p",
            uid: uid("block:0"),
          },
        ],
    type: "doc",
    uid: uid("doc"),
  };
}
