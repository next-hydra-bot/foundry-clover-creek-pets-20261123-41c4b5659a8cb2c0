import { SignOut } from "@repo/auth/components/sign-out";
import type { SignOutProps } from "@repo/auth/components/sign-out";
import type { SupportedLocale } from "@repo/i18n/config";
import { getPathname } from "@repo/i18n/navigation";

const preparation: SignOutProps = {};

export default async function SignOutPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: SupportedLocale }>;
}) {
  const { locale } = await params;
  return (
    <SignOut
      {...preparation}
      redirectUrl={
        preparation.redirectUrl ?? getPathname({ href: "/", locale })
      }
    />
  );
}
