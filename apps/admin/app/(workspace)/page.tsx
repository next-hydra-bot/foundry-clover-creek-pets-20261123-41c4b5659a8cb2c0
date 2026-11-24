import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { requireAdminSession, visibleAdminScreens } from "@/lib/admin-auth";

export default async function AdminOverviewPage() {
  const experiences = await visibleAdminScreens(await requireAdminSession());
  return (
    <div className="grid gap-6">
      <section>
        <Card className="border-stone-300 bg-white/90 shadow-sm backdrop-blur">
          <CardHeader className="gap-3">
            <p className="text-[11px] text-stone-500 uppercase tracking-[0.3em]">
              Overview
            </p>
            <CardTitle className="text-3xl text-stone-950">
              Admin tools
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-stone-600 leading-7">
              Choose an administration screen available to your account.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {experiences.length === 0 && (
          <p className="text-stone-600">
            No administration screens are available to your account.
          </p>
        )}
        {experiences.map((experience) => (
          <Link href={{ pathname: experience.href }} key={experience.href}>
            <Card className="h-full border-stone-300 bg-white/95 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md">
              <CardHeader className="gap-4">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-stone-950 text-white">
                  <ArrowRightIcon className="size-5" />
                </div>
                <div className="grid gap-2">
                  <CardTitle className="text-stone-950 text-xl">
                    {experience.title}
                  </CardTitle>
                  <CardDescription className="text-base text-stone-600 leading-7">
                    {experience.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <span className="inline-flex items-center gap-2 font-medium text-sm text-stone-950">
                  Open screen
                  <ArrowRightIcon className="size-4" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
