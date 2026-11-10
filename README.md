# @handijit/subscription

The licensing and subscription layer every Han Dijit desktop program shares. It decides in
Electron's main process what the running program may do — a free 7-day trial bound to the
device, then a monthly or yearly subscription bound to one device — keeps that decision
working offline until the license's own expiry, and gives the renderer the state and the
paywall to act on it.

- **Main decides, the page shows.** Licenses are verified in main (Ed25519 signature against
  the built-in keys, product, device, issue and expiry times) with `verifyLicense` of
  `@handijit/core`. The renderer receives a validated, serialisable state and never holds a
  license, a token or a device id. `subscription.require("notes", used)` enforces limits in
  main.
- **One explicit state.** Seven statuses (`loading`, `trial`, `subscribed`, `trial-expired`,
  `subscription-required`, `device-mismatch`, `unavailable`) plus the context every status
  carries ([The state](#the-state)).
- **Offline until the license says so, never beyond.** The last valid license is stored
  encrypted (`safeStorage` through `@handijit/electron`'s secret store) and used at once on the
  next start; it counts until its `exp` (72 hours after issue by default) and not a second
  longer. A clock turned back by more than 5 minutes stops the stored license from counting.
- **Renews on its own.** Every 6 hours, at half the license's life at the latest, when the
  window gets the focus back, when the computer wakes up, when the page reports the network
  back, after a sign-in or a sign-out, and on demand. Without the backend: again after 30 s,
  1, 2, 5 and then every 15 minutes, with jitter.
- **Purchase in the browser, unlock in the program.** "Buy yearly" opens
  `https://www.handijit.com/panel/hesabim/abonelik?product=<slug>&interval=yearly`; the program
  asks for the paid license after 5, 10, 15, 20 and then every 30 seconds and on every focus,
  for up to 30 minutes, and opens itself when it arrives.
- **Nothing throws, nothing overlaps.** One request at a time; no method rejects because of the
  network, the backend or the store; failures are part of the state.
- **Six entry points, one per place the code runs.** A build check keeps the page entries free
  of `electron` and `node:*`, and the preload entry free of everything.
- **Small where it ships to the page.** Preload 0.7 kB, client 2.2 kB, hook 0.5 kB,
  components 7.1 kB plus 1.9 kB of CSS, gzipped. No runtime dependency.
- **ES modules and CommonJS**, with types for both. Turkish texts, light and dark themes.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [The state](#the-state)
- [Licenses, offline use and the clock](#licenses-offline-use-and-the-clock)
- [Purchase, plans and the device](#purchase-plans-and-the-device)
- [Enforcing in main](#enforcing-in-main)
- [API](#api)
- [Logging and privacy](#logging-and-privacy)
- [What the smoke test covers](#what-the-smoke-test-covers)
- [Not in this package](#not-in-this-package)
- [Development](#development)

## Install

```sh
npm install @handijit/subscription @handijit/auth @handijit/electron @handijit/core zod
npm install @handijit/ui react react-dom   # only for the /react and /ui entries
npm install --save-dev electron
```

| Peer                 | Range              | Why                                                                                        |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `electron`           | `>=43.0.0 <46.0.0` | The range of `@handijit/electron`. The smoke test of this package runs on 45.              |
| `@handijit/auth`     | `^1.0.0`           | The customer's session: its `client` asks for the paid license with the access token.      |
| `@handijit/electron` | `^1.0.0`           | The IPC contract, the bridge and the secret store.                                         |
| `@handijit/core`     | `^1.1.0`           | License verification, the paid license and the plans, the error guards, the version check. |
| `zod`                | `^4.0.0`           | The schemas of the IPC contract (main only).                                               |
| `react` (optional)   | `>=18`             | Only for `/react` and `/ui`.                                                               |
| `@handijit/ui` (opt) | `^2.0.0`           | Only for `/ui`. Its stylesheet and the tokens of `@handijit/design` must be on the page.   |

Node 24 or newer for the tooling. The main-process code runs on the Node that Electron embeds.
The subscription only uses `@handijit/auth` through its `Auth` instance; it never imports it.

## Quick start

### 1. main

```ts
import { createAuth } from "@handijit/auth/main";
import { startApp } from "@handijit/electron/main";
import { app } from "electron";
import {
  createSubscription,
  registerSubscriptionIpc,
} from "@handijit/subscription/main";

const auth = createAuth({ product: "notlar" });
const subscription = createSubscription({ product: "notlar", auth });

// No top-level `await`: Electron emits `ready` only after an ES module main has finished
// evaluating, so awaiting the start-up here would wait forever.
startApp({
  contract, // the program's own contract, with authContract inside
  handlers: () => ({ ...auth.handlers /* , the program's own */ }),
  rendererRoot,
  window: { preload, width: 1100, height: 720 },
  beforeWindow: (context) => {
    auth.attach(context);
    registerSubscriptionIpc({ subscription, policy: context.policy });
    void subscription.start();
  },
}).catch((error: unknown) => {
  console.error("The program could not start", error);
  app.exit(1);
});

// Anywhere in main, before doing what the plan limits:
subscription.require("notes", await countNotes());
```

`start()` restores the session, applies the stored license and resolves; the first request to
the backend runs in the background. On a computer that never ran the program it resolves with
`loading`, and the state follows as soon as the backend has answered.

To put the channels into the program's own contract instead, spread `subscriptionContract`
into it and `createSubscriptionHandlers(subscription)` into its handlers, and broadcast
`subscription:state-changed` from `subscription.onChange`.

### 2. preload

```ts
import { exposeBridge } from "@handijit/electron/preload";
import { withSubscriptionChannels } from "@handijit/subscription/preload";

exposeBridge(withSubscriptionChannels(APP_CHANNELS));
```

It composes with the other packages' helpers:
`withUpdateChannels(withSubscriptionChannels(APP_CHANNELS))`. A channel that is already in the
list is a `TypeError` at start-up.

### 3. renderer

```tsx
import "@handijit/design/fonts.css";
import "@handijit/design/tokens.css";
import "@handijit/ui/styles.css";
import "@handijit/subscription/styles.css";

import { useAuth } from "@handijit/auth/react";
import {
  SubscriptionGate,
  SubscriptionStatus,
  TrialBanner,
} from "@handijit/subscription/ui";

const App = () => {
  const auth = useAuth();
  return (
    <SubscriptionGate
      productName="Notlar"
      onSignIn={() => void auth.signIn()}
      isSigningIn={auth.status === "signing-in"}
    >
      <TrialBanner />
      <Program />
      {/* on the settings page: <SubscriptionStatus /> */}
    </SubscriptionGate>
  );
};
```

The gate renders the program as it is while a trial or a subscription is in force. Otherwise
it covers the window (the program stays mounted behind it, `inert`) and offers what can be
done. Until main has decided it shows a quiet "Lisans denetleniyor…" cover.

## The state

One frozen, serialisable object. `status` says what the program may do; the other fields
belong to the status, and the context is on every status:

| Status                  | Fields                                             | Meaning                                                                                                                               |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`               | —                                                  | Nothing decided yet: the stored license is being read, or the first answer of a new computer is awaited.                              |
| `trial`                 | `trialEndsAt`, `licenseExpiresAt`                  | A verified trial license is in force.                                                                                                 |
| `subscribed`            | `plan` (`monthly` \| `yearly`), `licenseExpiresAt` | A verified paid license is in force.                                                                                                  |
| `trial-expired`         | `trialEndedAt` (`null` when unknown)               | The device's trial is over and nobody with a subscription is signed in.                                                               |
| `subscription-required` | —                                                  | No license without a subscription: signed in without a live one, or the program offers no trial.                                      |
| `device-mismatch`       | `boundDevice: { name, os }` (each may be `null`)   | The account's subscription is bound to another installation.                                                                          |
| `unavailable`           | `reason`                                           | No license in force and none obtainable: `offline`, `service`, `clock`, `update-required`, `license-invalid`, `unsupported-platform`. |

Context: `revision` (counts the changes), `isSignedIn`, `isOffline` (the last license request
did not reach the backend), `isRefreshing`, `checkedAt` (the backend's last answer),
`limits` (the verified license's limits; `{}` without a license), `plans`
(`{ status: "idle" | "loading" | "ready" | "failed", offers: [{ interval, priceKurus, currency, isAvailable }] }`)
and `purchase` (`{ interval, startedAt, expiresAt }` while one is awaited, else `null`).
Every moment is epoch milliseconds.

**Offline is not a status of its own.** A held license that is still valid stays `trial` or
`subscribed` with `isOffline: true`; a refusal the backend already gave (`trial-expired`, …)
stays what it was; only when there is neither does the state become
`unavailable` / `offline`.

Precedence: an unsupported platform, then `loading`, then a clock turned back, then a valid
license, then the backend's last refusal, then a trial known to be over (from the stored
license or the backend's earlier answer, only while signed out), then the last failure.

## Licenses, offline use and the clock

- **Which license.** Signed in: `POST /api/customer/licenses` with the session. When the
  backend says there is no subscription for this device (`SUBSCRIPTION_REQUIRED`,
  `SUBSCRIPTION_DEVICE_MISMATCH`, or the session was refused), the trial license is asked for
  too, so that a signed-in customer still in the trial keeps working. Signed out:
  `POST /api/public/licenses`.
- **Verification** happens in main for every license, fresh or stored, against the keys
  passed as `keys` (default: `PRODUCTION_LICENSE_KEYS` of `@handijit/core`). Keys are never
  fetched from the network; the backend's documentation forbids it. Key rotation means a new
  key in a release of `@handijit/core` before the backend signs with it. A fresh license
  signed by a key this build does not know makes the state `unavailable` / `update-required`.
- **Storage.** The last valid license, the customer it was issued to, the end of the trial
  when the backend reported it, and the latest moment seen are kept in the secret
  `subscription-license` (encrypted by the operating system; nothing is written in plain
  text, and without encryption the record lives in memory only). A paid license is used only
  while the customer it was issued to is signed in; a sign-out or another customer drops it.
- **Offline.** A stored license counts until its `exp` and not beyond, with or without a
  backend. Its expiry is timed: the state changes at that second, not at the next renewal.
- **The clock.** The latest moment seen (from the local clock while running, reset by every
  freshly verified license) is kept with the record and written at most every 10 minutes.
  A clock more than 5 minutes behind it makes the state `unavailable` / `clock` until a fresh
  license verifies. Licenses are verified with 5 minutes of tolerance against `iat` and `exp`;
  a fresh license that fails on time while the backend's `serverTime` disagrees with the
  local clock is blamed on the clock, otherwise it is `license-invalid`.
- **Rate limits.** The backend allows 60 license requests in 10 minutes per address and per
  customer. Requests closer than 2 seconds are folded into one; a `429` pauses everything for
  `Retry-After` (10 minutes without it).

## Purchase, plans and the device

- `purchase("monthly" | "yearly")` opens the subscription page on the web site in the system
  browser (only `https` addresses; `http` only towards `127.0.0.1`/`localhost` for tests). A
  signed-out customer signs in on the web to pay, and in the program to receive the license;
  the gate says so while the purchase is pending.
- While a purchase is pending only the paid license is asked for, so a running trial is left
  alone; refusals and failures change nothing. It ends when a paid license arrives,
  `cancelPurchase()` is called or `purchaseTimeoutMs` passes.
- `manage()` opens the same page without a plan: cancel, change the card, free the device
  (the panel allows it twice in 30 days).
- Plans are read from `GET /api/public/products/{slug}/plans` as soon as the paywall or the
  trial banner may show them, kept for an hour, and only shown. An unknown interval is
  skipped; a `404` (not on sale) is an empty, ready list; any other failure is
  `plans.status: "failed"` and the paywall still offers both plans without prices.

## Enforcing in main

```ts
subscription.isEntitled(); // a trial or a subscription is in force
subscription.check("notes", 42); // { isAllowed: true } or { isAllowed: false, reason: "not-entitled" | "limit-reached", limit, max }
subscription.require("notes", 42); // throws SubscriptionAccessError (NOT_ENTITLED | LIMIT_REACHED)
```

`used < max` must hold: a limit of 0 switches a feature off, and a limit the license does not
name is unlimited. Each call re-reads the clock, so a license that just expired is refused.

## API

### `@handijit/subscription/main`

- `createSubscription(options): Subscription` — options: `product` (slug, required),
  `auth` (the `createAuth` instance, required), `logger?`, `secretStore?`, `keys?`,
  `panelBaseUrl?` (default `https://www.handijit.com`), `openExternal?`, `appVersion?`
  (default `app.getVersion()`), `deviceId?`, `deviceName?` (default the host name),
  `refreshIntervalMs?` (6 h), `purchaseTimeoutMs?` (30 min), and for tests `platform`, `arch`,
  `now`, `random`. Throws a `TypeError` for a setting that can only be a programming error.
- `Subscription`: `getState()`, `onChange(listener) → Unsubscribe`, `start()`, `refresh()`,
  `isEntitled()`, `check(limit?, used?)`, `require(limit?, used?)`, `loadPlans()`,
  `purchase(interval) → Promise<boolean>`, `cancelPurchase()`, `manage() → Promise<boolean>`,
  `dispose()`.
- `registerSubscriptionIpc({ subscription, policy, onError? }): Unsubscribe`,
  `createSubscriptionHandlers(subscription)`, `subscriptionContract` (channels
  `subscription:get-state`, `:refresh`, `:load-plans`, `:purchase` (input `{ interval }`),
  `:cancel-purchase`, `:manage`, event `subscription:state-changed`).
- `SubscriptionAccessError` (`code`, `limit`, `max`).

### `@handijit/subscription/preload`

`withSubscriptionChannels(channels)`, `SUBSCRIPTION_CHANNELS`.

### `@handijit/subscription/renderer`

`subscriptionClient` (the page's one client), `createSubscriptionClient()`,
`isSubscriptionState(value)`. The client: `getState()`, `subscribe(listener)`, `refresh()`,
`loadPlans()`, `purchase(interval)`, `cancelPurchase()`, `manage()`. It keeps the newest state
by `revision`, ignores anything that is not a state, and passes the window's `online` event to
main while connected.

### `@handijit/subscription/react`

`useSubscription(client?)` → `{ state, refresh, loadPlans, purchase, cancelPurchase, manage }`.

### `@handijit/subscription/ui`

- `<SubscriptionGate productName onSignIn? isSigningIn? titleBar? labels? client?>`
- `<TrialBanner interval? warnDays? labels? className? client?>` — renders only in `trial`.
- `<SubscriptionStatus labels? className? client?>` — for a settings page.
- `DEFAULT_SUBSCRIPTION_LABELS`; every text can be replaced through `labels`.

### `@handijit/subscription`: shared

`isSubscriptionState`, `withSubscriptionChannels`, `SUBSCRIPTION_CHANNELS`,
`SUBSCRIPTION_STATUSES`, `UNAVAILABLE_REASONS`, `PLAN_INTERVALS`, `PLANS_STATUSES`, and the
types.

## Logging and privacy

The logger receives what happened — a license issued (plan, key id, expiry), refused (status),
a failed request (kind, status, code), the clock turned back — never the license, a token or
the device id. The device id is the SHA-256 (base64url) of the operating system's machine id
(`IOPlatformUUID` on macOS, `MachineGuid` on Windows, read with an absolute path and no shell)
and the product, so the backend never sees the machine id itself, a reinstall finds the same
id (the trial cannot be restarted) and two products see two ids. Without a readable machine
id it is random and stored.

## What the smoke test covers

`npm run test:electron` launches a real Electron four times with the built package and the
real `@handijit/auth` against a local stand-in of the backend that signs real Ed25519
licenses with a key made for the run (68 checks on Electron 45):

1. a new computer gets a trial (7 days, limits from the license, stored encrypted), the trial
   runs out, the paywall covers the program with the backend's prices, main refuses work,
   and "buy yearly" opens the subscription page for the plan;
2. a restart shows the paywall at once, the customer pays (played by the runner) and signs in
   through the browser, the paid license arrives and the paywall opens — with the same device
   id as the trial;
3. a restart with no network at all is carried by the stored paid license;
4. the same customer on a second computer is told which computer the subscription is bound
   to and offered the panel.

It cannot prove the Windows machine id on macOS or the other way round: CI runs it on both.

## Not in this package

- Payment, invoices and freeing a device: the web panel does them.
- Signing in: `@handijit/auth`; the gate only calls the `onSignIn` it is given.
- Updating the program: `@handijit/electron-update`.
- Linux: the backend issues licenses for Windows and macOS only.

## Development

```sh
npm ci
npm run verify            # lint, typecheck, tests with 100 % coverage, build, sizes, package lint
npm run test:electron     # the smoke test in a real Electron (after npm run build)
npm run screenshots       # every status of the components, light and dark, in real Chromium
sh scripts/smoke-test.sh  # installs the packed tarball into an empty project and uses it
```

Publishing happens from a GitHub release through `.github/workflows/publish.yml`.

## License

MIT
