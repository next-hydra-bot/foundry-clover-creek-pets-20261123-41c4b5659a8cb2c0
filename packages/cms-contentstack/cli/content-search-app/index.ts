import { searchableContentTypes } from "../../search-content-types";
import { createContentSearchAppInstaller } from "./program";

export const installContentSearchApp = createContentSearchAppInstaller(
  searchableContentTypes
);
