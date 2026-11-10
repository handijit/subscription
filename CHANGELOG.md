# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-11-10

### Changed

- Requires `@handijit/core ^1.1.0` (peer and development). That release carries the rotated
  production license key (`hd-license-2026-11-r2`); the old one was withdrawn, so a program
  must be built against it to accept the licenses the API signs now.
- The paid license and the plans are asked for through the client's own methods,
  `issuePaidLicense` and `getPlans`, instead of generic `request` calls; the bound device of a
  `SUBSCRIPTION_DEVICE_MISMATCH` is read with `readBoundDevice`, and the refusals are told apart
  by `ERROR_CODES` and `isSubscriptionDeviceMismatch`. The `auth.client` a program passes needs
  `issuePaidLicense` and `getPlans` (the `@handijit/auth` client has them with core 1.1).

### Added

- `TrialBanner` `layout="stacked"`: the heading, the days left and a full-width "Abone ol"
  under each other, on the surface colour, for the plan area at the foot of a sidebar. Two new
  labels go with it, `trialTitle` and `trialDaysLeft(days)`.

## [1.0.1] - 2026-11-10

### Fixed

- The quick start no longer awaits `startApp` at the top level of an ES module main: Electron
  emits `ready` only after the main module has finished evaluating, so the program hung at
  start-up. It now calls `startApp(...).catch(...)`.
- The "Enforcing in main" example names the `reason` values of `check()`
  (`"not-entitled" | "limit-reached"`) next to the codes `require()` throws.

## [1.0.0] - 2026-11-10

First release: the licensing and subscription layer of Han Dijit's Electron
desktop programs, in six entry points (`.`, `./main`, `./preload`,
`./renderer`, `./react`, `./ui`) and a stylesheet (`./styles.css`), as ES
modules and CommonJS.

### Added

- `createSubscription`: one subscription per main process, an explicit and
  serialisable state (`loading`, `trial`, `subscribed`, `trial-expired`,
  `subscription-required`, `device-mismatch`, `unavailable`) over the license
  the backend issues: the paid license while a customer is signed in (with a
  fall-back to the running trial), the trial license otherwise.
- License verification in main with `verifyLicense` of `@handijit/core`
  against the built-in keys; the last valid license stored encrypted and used
  offline until its own expiry, never beyond; a guard against a clock turned
  back.
- Renewal every 6 hours, at half the license's life, on focus, on resume,
  after a sign-in or a sign-out and on demand, with a backoff without the
  backend and respect for `Retry-After`.
- `purchase` and `manage`: the subscription page in the system browser and
  polling for the paid license while a purchase is pending; the plans and
  their prices for display.
- `check` and `require` (`SubscriptionAccessError`) for main-side enforcement
  of the plan's limits.
- A device id derived from the operating system's machine id and the product,
  so that a reinstall cannot restart the trial.
- `subscriptionContract`, `createSubscriptionHandlers` and
  `registerSubscriptionIpc`; `withSubscriptionChannels` and
  `SUBSCRIPTION_CHANNELS` for the preload, without Zod.
- `subscriptionClient`, `useSubscription`, and the components
  `SubscriptionGate`, `TrialBanner` and `SubscriptionStatus` on `@handijit/ui`
  2, in Turkish, for the light and the dark theme.

[Unreleased]: https://github.com/handijit/subscription/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/handijit/subscription/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/handijit/subscription/releases/tag/v1.0.0
