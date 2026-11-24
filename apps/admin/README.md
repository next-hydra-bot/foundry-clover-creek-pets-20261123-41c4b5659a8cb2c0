# Admin host and screens

Select `admin-app` to install the authenticated Admin host independently of commerce or company registration. Its authentication routes use the selected provider with separate Admin credentials and host-only cookies. No registration API URL is required by the host.

B2B registration installs `commerce-registration-admin`, which includes the host and its approval screen, API client, decision actions and tests. It contributes `registrationPermissions` to the Admin manifest in `auth-contract` and `registrationAdminScreens` to the host's navigation template. These definitions remain owned by company registration. The storefront manifest is composed separately.

The shared layout requires a signed-in Admin session. Overview and navigation show installed screens for which the session has every declared permission. Navigation is presentation only: each screen must independently check its read permission, and every action must check its mutation permission. Registration requires `registration.read` for the page and `registration.decide` for decisions; the API verifies the same caller against the separate Admin identity application.

Additional screen recipes contribute descriptors to `apps/admin/lib/admin-screens.ts#screens` and permissions to `packages/auth-contract/permissions/admin.ts#permissions`. A route can use `requireAdminPermission` with the composed vocabulary, or a feature's typed authorization adapter. Feature-specific clients, actions and tests belong to that screen recipe. The host should never acquire a feature permission in its shared layout.
