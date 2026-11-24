import schema from "../content_types/article.json" with { type: "json" };
import type { SearchContentType } from "./types.ts";
export const articleSearchType = {
  uid: schema.uid,
  label: schema.title,
  searchTextRoot: "articles",
  mappingFields: ["title", "summary", "url"],
  instructions: [
    "Use the article title, summary, body rich text and URL. Keep draft articles out of the public index.",
  ],
} satisfies SearchContentType;
