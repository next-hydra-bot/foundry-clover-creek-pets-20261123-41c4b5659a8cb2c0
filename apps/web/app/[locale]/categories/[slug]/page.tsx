import {
  CategoryPageSkeleton,
  generateCategoryMetadata,
} from "@repo/commerce-core/product/category-pages";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { CategoryPage } from "@repo/search/category-page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/categories/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return await generateCategoryMetadata({ locale, slug });
}

export default async function CategoryRoute({
  params,
  searchParams,
}: PageProps<"/[locale]/categories/[slug]">) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Match the repository's next-intl request-locale contract.
  setRequestLocale(locale);
  return (
    <Suspense fallback={<CategoryPageSkeleton />}>
      <CategoryPage locale={locale} slug={slug} searchParams={searchParams} />
    </Suspense>
  );
}
