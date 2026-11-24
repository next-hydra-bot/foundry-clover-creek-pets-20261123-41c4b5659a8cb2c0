import { Button } from "@repo/design-system/components/ui/button";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Input } from "@repo/design-system/components/ui/input";
import { useTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n";
import { useId, useState } from "react";
import {
  Configure,
  useClearRefinements,
  useHits,
  useRange,
  useInstantSearch,
  useRefinementList,
  useSearchBox,
  useSortBy,
  useStats,
} from "react-instantsearch";

import { searchFacetLabels } from "./contract";
import { humanizeSearchValue } from "./presentation";
import {
  attributeFacetLabel,
  attributeFacetValueLabel,
} from "./product-attribute-discovery";
import { SearchProductCard } from "./product-card";
import type { ProductSearchHit } from "./product-contract";
import type { ProductRefinementFacet } from "./product-discovery";
import {
  PRODUCT_LISTING_CONFIGURE,
  PRODUCT_LISTING_RANGE_OPTIONS,
  productListingFacets,
  PRODUCT_LISTING_SORT_ITEMS,
  productListingRefinementListOptions,
} from "./product-listing-config";
import { SearchPagination } from "./search-pagination";
import { SearchQuery } from "./search-query";

export interface ProductListingViewProps {
  readonly categoryKey?: string;
  readonly locale: Locale;
}

interface FacetListProps {
  readonly attribute: ProductRefinementFacet["id"];
  readonly locale: Locale;
  readonly heading?: string;
}

function FilterSection({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-b py-5 last:border-b-0">
      <fieldset className="min-w-0">
        <legend className="mb-3 font-medium text-sm">{label}</legend>
        {children}
      </fieldset>
    </section>
  );
}

function FacetList({ attribute, locale, heading }: FacetListProps) {
  const t = useTranslations("web.search.productListing");
  const { results } = useInstantSearch();
  const labels = searchFacetLabels(results.userData)[attribute];
  const { canToggleShowMore, isShowingMore, items, refine, toggleShowMore } =
    useRefinementList({
      attribute,
      ...productListingRefinementListOptions(attribute),
    });

  if (items.length === 0) {
    return null;
  }
  const controls = (
    <div>
      <div className="space-y-2.5">
        {items.map((item) => {
          const id = `${attribute}-${item.value}`;
          return (
            <div className="flex items-start gap-2.5" key={item.value}>
              <Checkbox
                checked={item.isRefined}
                className="mt-0.5 shrink-0"
                id={id}
                onCheckedChange={() => {
                  refine(item.value);
                }}
              />
              <label
                className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-3 text-sm leading-5"
                htmlFor={id}
              >
                <span className="min-w-0 break-words">
                  {attribute.startsWith("attribute.")
                    ? attributeFacetValueLabel(attribute, item.value, locale)
                    : (labels?.[item.value] ?? humanizeSearchValue(item.label))}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {item.count}
                </span>
              </label>
            </div>
          );
        })}
      </div>
      {canToggleShowMore ? (
        <Button
          className="mt-3 h-8 px-0"
          onClick={toggleShowMore}
          size="sm"
          type="button"
          variant="link"
        >
          {isShowingMore ? t("showLess") : t("showMore")}
        </Button>
      ) : null}
    </div>
  );
  return heading ? (
    <FilterSection label={heading}>{controls}</FilterSection>
  ) : (
    controls
  );
}

function FacetRange({
  attribute,
  label,
}: {
  readonly attribute: string;
  readonly label: string;
}) {
  const t = useTranslations("web.search.productListing");
  const { setIndexUiState } = useInstantSearch();
  const { canRefine, range, start } = useRange({
    attribute,
    ...PRODUCT_LISTING_RANGE_OPTIONS,
  });
  if (!canRefine && attribute !== "price") {
    return null;
  }
  const [minimum, maximum] = start;
  const step = 10 ** -PRODUCT_LISTING_RANGE_OPTIONS.precision;

  return (
    <FilterSection label={label}>
      <form
        className="grid grid-cols-2 gap-2"
        key={`${minimum}:${maximum}:${range.min}:${range.max}`}
        onSubmit={(event) => {
          event.preventDefault();
          const from = event.currentTarget.elements.namedItem("min");
          const to = event.currentTarget.elements.namedItem("max");
          if (
            !(from instanceof HTMLInputElement) ||
            !(to instanceof HTMLInputElement)
          ) {
            return;
          }
          const nextMinimum = from.value ? from.valueAsNumber : undefined;
          const nextMaximum = to.value ? to.valueAsNumber : undefined;
          // The range connector floors/ceils decimal inputs. UI state preserves
          // the submitted values through its native search-parameter mapping.
          setIndexUiState((state) => {
            const nextRange = Object.fromEntries(
              Object.entries(state.range ?? {}).filter(
                ([key]) => key !== attribute
              )
            );
            if (nextMinimum !== undefined || nextMaximum !== undefined) {
              nextRange[attribute] =
                `${nextMinimum ?? ""}:${nextMaximum ?? ""}`;
            }
            return { ...state, page: 1, range: nextRange };
          });
        }}
      >
        <label className="min-w-0 space-y-1.5 text-muted-foreground text-xs">
          <span>{t("minimum")}</span>
          <Input
            className="h-9 min-w-0 text-foreground"
            defaultValue={Number.isFinite(minimum) ? minimum : ""}
            disabled={!canRefine}
            max={range.max}
            min={range.min}
            name="min"
            placeholder={range.min?.toString()}
            step={step}
            type="number"
          />
        </label>
        <label className="min-w-0 space-y-1.5 text-muted-foreground text-xs">
          <span>{t("maximum")}</span>
          <Input
            className="h-9 min-w-0 text-foreground"
            defaultValue={Number.isFinite(maximum) ? maximum : ""}
            disabled={!canRefine}
            max={range.max}
            min={range.min}
            name="max"
            placeholder={range.max?.toString()}
            step={step}
            type="number"
          />
        </label>
        <Button
          className="col-span-2 mt-1 justify-self-end"
          disabled={!canRefine}
          size="sm"
          type="submit"
          variant="outline"
        >
          {t("apply")}
        </Button>
      </form>
    </FilterSection>
  );
}

function ProductFilters({ locale, categoryKey }: ProductListingViewProps) {
  const t = useTranslations("web.search.productListing");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { canRefine, refine: clear } = useClearRefinements();
  const baseLabels = new Map([
    ["category", t("facets.category")],
    ["availability", t("facets.availability")],
    ["price", t("facets.price")],
  ]);

  return (
    <aside aria-label="Product filters" className="w-full shrink-0 lg:w-60">
      <div className="flex min-h-10 items-center justify-between gap-4 border-b pb-3">
        <h2 className="hidden font-semibold text-sm lg:block">
          {t("filters")}
        </h2>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="flex min-h-10 items-center gap-2 font-semibold text-sm lg:hidden"
          onClick={() => {
            setOpen(!open);
          }}
          type="button"
        >
          {t("filters")}
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        {canRefine ? (
          <Button
            className="h-8 px-0 text-xs"
            onClick={clear}
            size="sm"
            type="button"
            variant="link"
          >
            {t("clearAll")}
          </Button>
        ) : null}
      </div>
      <div className={open ? "block" : "hidden lg:block"} id={panelId}>
        {productListingFacets(categoryKey).map((facet) => {
          const label = facet.id.startsWith("attribute.")
            ? (attributeFacetLabel(facet.id, locale) ?? facet.id)
            : (baseLabels.get(facet.id) ?? facet.id);
          return facet.control === "range" ? (
            <FacetRange attribute={facet.id} key={facet.id} label={label} />
          ) : (
            <FacetList
              attribute={facet.id}
              heading={label}
              key={facet.id}
              locale={locale}
            />
          );
        })}
      </div>
    </aside>
  );
}

function ProductQuery() {
  const { query, refine } = useSearchBox();

  return (
    <div className="flex-1">
      <SearchQuery label="Search products" query={query} refine={refine} />
    </div>
  );
}

function ProductSort() {
  const { currentRefinement, options, refine } = useSortBy({
    items: PRODUCT_LISTING_SORT_ITEMS,
  });

  return (
    <label className="flex shrink-0 items-center gap-2 text-sm">
      <span>Sort by</span>
      <select
        aria-label="Sort products"
        className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        onChange={(event) => {
          refine(event.currentTarget.value);
        }}
        value={currentRefinement}
      >
        {options.map(({ label, value }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProductResults({ locale }: { readonly locale: Locale }) {
  const { status } = useInstantSearch({ catchError: true });
  const { items } = useHits<ProductSearchHit>();
  const { nbHits } = useStats();

  if (status === "error") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="font-semibold">Product search is unavailable</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Please try again shortly.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <h2 className="font-semibold text-lg">
          {status === "loading" || status === "stalled"
            ? "Loading products…"
            : "No products found"}
        </h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Try changing or clearing a filter.
        </p>
      </div>
    );
  }

  return (
    <>
      <p aria-live="polite" className="mb-5 text-muted-foreground text-sm">
        {nbHits.toLocaleString(locale)} {nbHits === 1 ? "product" : "products"}
      </p>
      <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((hit) => (
          <div data-search-hit={hit.objectID} key={hit.objectID}>
            <SearchProductCard hit={hit} locale={locale} />
          </div>
        ))}
      </div>
      <SearchPagination label="Product listing pagination" />
    </>
  );
}

export function ProductListingView({
  locale,
  categoryKey,
}: ProductListingViewProps) {
  return (
    <>
      <Configure {...PRODUCT_LISTING_CONFIGURE} />
      <div className="mb-8 flex flex-col gap-4 border-b pb-8 sm:flex-row">
        <ProductQuery />
        <ProductSort />
      </div>
      <div className="flex min-h-0 flex-col items-start gap-8 lg:flex-row lg:gap-10">
        <ProductFilters categoryKey={categoryKey} locale={locale} />
        <div className="min-w-0 w-full flex-1">
          <ProductResults locale={locale} />
        </div>
      </div>
    </>
  );
}
