import {
  CategoryIndexPage,
  CategoryPageSkeleton,
} from "@repo/commerce-core/product/category-pages";
import { getTranslations, hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/categories">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: "web.categories" });
  return { title: t("title"), description: t("description") };
}

export default async function CategoriesPage({
  params,
}: PageProps<"/[locale]/categories">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Match the repository's next-intl request-locale contract.
  setRequestLocale(locale);
  return (
    <Suspense fallback={<CategoryPageSkeleton />}>
      <CategoryIndexPage locale={locale} />
    </Suspense>
  );
}
