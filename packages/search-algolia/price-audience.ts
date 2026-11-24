export const PUBLIC_PRICE_AUDIENCE_ID = "public";

export const parsePriceCustomerGroupIds = (
  value: string | undefined
): readonly string[] => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  ),
];

export const resolvePriceAudienceIds = (
  audienceIds: readonly string[],
  configuredCustomerGroupIds: readonly string[]
): readonly string[] => {
  // Group audiences come only from verified provider buyer context.
  // A missing indexed group must return no matches, never public prices.
  const company = audienceIds.filter((id) => id.startsWith("group:"));
  if (company.length > 0) {
    if (
      company.length !== 1 ||
      audienceIds.length !== 1 ||
      company[0] === "group:"
    ) {
      throw new Error("Company search requires one verified pricing group");
    }
    return company;
  }
  const allowed = new Set(configuredCustomerGroupIds);
  const matching = audienceIds.filter((id) => allowed.has(id));
  return matching.length === 0 ? [PUBLIC_PRICE_AUDIENCE_ID] : matching;
};
