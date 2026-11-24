const SURROUNDING_SLASHES = /^\/+|\/+$/g;
const NEXT_DYNAMIC_ROUTE_PLACEHOLDER = /^%%drp:url:[0-9a-f]*%%$/;

function toCmsPath(path: string): string {
  const normalizedPath = path.trim().replace(SURROUNDING_SLASHES, "");

  return normalizedPath ? `/${normalizedPath}` : "/";
}

export function resolveCmsPagePath(
  url: string | readonly string[] | undefined,
  homepageSlug: string
): string {
  const requestedPath = typeof url === "string" ? url : url?.join("/");

  return requestedPath && !NEXT_DYNAMIC_ROUTE_PLACEHOLDER.test(requestedPath)
    ? toCmsPath(requestedPath)
    : toCmsPath(homepageSlug);
}
