# Stripe setup

Set `STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY` on the server that runs checkout. This is usually `apps/api` with a separate Commerce API and `apps/web` when checkout runs in the storefront. Use the sandbox account's matching `pk_test_` and `sk_test_` keys. The server supplies the publishable configuration to checkout.

## Use a Stripe Marketplace sandbox on Vercel

Attach the Stripe sandbox to the Vercel project and environments that run checkout. Vercel supplies `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Checkout reads these directly. If you set `STRIPE_PUBLISHABLE_KEY` explicitly, it takes precedence. Deploy after the keys are available and verify checkout with a Stripe test card.

## Configure sandbox payment settings

Use an account-level test key in `STRIPE_SECRET_KEY`, such as the key from a Marketplace sandbox in an authorized private development environment. The command identifies the account from that key. Supply `--account-id` to check the expected account. To use a dedicated provisioning credential, set `STRIPE_PROVISIONING_KEY`. Organization keys require `--account-id`. The credential needs to read the account and payment method configurations and update the configuration if cards need to be enabled.

```sh
pnpm --filter cli cli --env-file /private/path/stripe-provisioning.env \
  payments provision
```

The command confirms the account and test mode through Stripe, then ensures cards are enabled on the default payment method configuration. Checkout uses cards with manual capture. Restart or redeploy with the account's runtime keys and verify checkout using Stripe test cards.

## Register an existing webhook receiver

For an app that already runs a Stripe webhook receiver, pass its public HTTPS URL, the event types it handles, and a private output path outside Git. The provisioning key also needs read and write access to Stripe webhook endpoints.

```sh
pnpm --filter cli cli --env-file /private/path/stripe-provisioning.env \
  payments provision --account-id acct_example \
  --webhook-url https://store.example.com/api/stripe/webhook \
  --webhook-event payment_intent.succeeded \
  --webhook-event payment_intent.payment_failed \
  --webhook-output /private/path/stripe-webhook.env
```

Use the saved `STRIPE_WEBHOOK_SECRET` in the receiver and verify a signed test delivery. Retain the private file to reuse the endpoint and reconcile its event list on a retry. If the file is lost after Stripe creates the endpoint, recover the signing secret for the recorded endpoint in Stripe before retrying. The command prints account, configuration and endpoint IDs, plus the output path.

[Stripe sandbox keys](https://docs.stripe.com/sandboxes/dashboard/manage-access) · [Organization API keys](https://docs.stripe.com/keys/organization-api-keys) · [Webhooks](https://docs.stripe.com/webhooks)
