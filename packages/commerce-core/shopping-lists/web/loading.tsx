import {
  SavedProductList,
  SavedProductRow,
} from "@repo/design-system/components/commerce/saved-product-row";
import { CustomerAreaContentSkeleton } from "@repo/design-system/components/layout/customer-area";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";

export function ShoppingListRowsSkeleton({
  count = 2,
  quantity = false,
}: {
  readonly count?: number;
  readonly quantity?: boolean;
}) {
  return (
    <div role="status" aria-label="Loading saved products">
      <span className="sr-only">Loading saved products</span>
      <SavedProductList busy>
        {Array.from({ length: count }, (_, row) => (
          <SavedProductRow
            key={row}
            media={<Skeleton aria-hidden="true" className="size-full" />}
            actions={
              <div aria-hidden="true" className="flex items-end gap-2">
                {quantity ? (
                  <div className="grid gap-2">
                    <Skeleton className="h-3.5 w-16" />
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-20" />
                      <Skeleton className="h-9 w-20" />
                    </div>
                  </div>
                ) : null}
                <Skeleton className="h-9 w-28" />
              </div>
            }
          >
            <div aria-hidden="true" className="grid gap-2">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-5 w-32 max-w-full" />
              <Skeleton className="h-4 w-28 max-w-full" />
            </div>
          </SavedProductRow>
        ))}
      </SavedProductList>
    </div>
  );
}

export function ShoppingListSkeleton() {
  return (
    <CustomerAreaContentSkeleton>
      <div className="grid gap-4">
        <Skeleton className="h-9 w-20" />
        <ShoppingListRowsSkeleton />
      </div>
    </CustomerAreaContentSkeleton>
  );
}

export function ShoppingListsSkeleton() {
  return (
    <CustomerAreaContentSkeleton>
      <div className="grid gap-6">
        <div className="grid gap-5 rounded-xl border p-6">
          <Skeleton className="h-6 w-32" />
          <div className="flex items-end gap-3">
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="grid gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="grid gap-2 rounded-lg border p-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    </CustomerAreaContentSkeleton>
  );
}
