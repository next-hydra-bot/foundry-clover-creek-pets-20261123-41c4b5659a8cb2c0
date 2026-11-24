"use client";
import { useActionState } from "react";

export interface ImpersonationActionResult {
  readonly error?: string;
  readonly destination?: {
    readonly mode: "direct" | "providerDashboard";
    readonly url: string;
  };
}
export type ImpersonationAction = (
  previous: ImpersonationActionResult,
  form: FormData
) => Promise<ImpersonationActionResult>;
export function ImpersonationLaunchForm({
  action,
  userId,
}: {
  readonly action: ImpersonationAction;
  readonly userId: string;
}) {
  const [result, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className="grid gap-3 rounded border p-4">
      <input name="userId" type="hidden" value={userId} />
      <label>
        Reason for access
        <textarea
          className="block w-full rounded border p-2"
          name="reason"
          required
          maxLength={1000}
        />
      </label>
      <button
        className="rounded border px-4 py-2"
        disabled={pending}
        type="submit"
      >
        {pending ? "Preparing…" : "Prepare impersonation"}
      </button>
      {result.error && <p role="alert">{result.error}</p>}
      {result.destination && (
        <>
          <p>
            {result.destination.mode === "providerDashboard"
              ? "Continue in WorkOS. You need WorkOS team access and will provide the final reason there. This link has not started a customer session."
              : "Open the one-use link to start the customer session. It replaces the current shopper session in that browser."}
          </p>
          <a
            className="underline"
            href={result.destination.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {result.destination.mode === "providerDashboard"
              ? "Open WorkOS impersonation"
              : "Open customer session"}
          </a>
        </>
      )}
    </form>
  );
}
