// The page the screenshots are taken of: every status of the paywall, the trial banner and
// the status block. The scene and the theme come from the address: index.html?<scene>/<theme>.
import "@handijit/design/fonts.css";
import "@handijit/design/tokens.css";
import "@handijit/ui/styles.css";
import "@handijit/subscription/styles.css";
import "./page.css";

import type { SubscriptionState } from "@handijit/subscription";
import type { SubscriptionClient } from "@handijit/subscription/renderer";
import {
  SubscriptionGate,
  SubscriptionStatus,
  TrialBanner,
} from "@handijit/subscription/ui";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";

const NOW = Date.now();
const DAY_MS = 86_400_000;

const OFFERS = [
  {
    interval: "monthly",
    priceKurus: 14_990,
    currency: "TRY",
    isAvailable: true,
  },
  {
    interval: "yearly",
    priceKurus: 149_900,
    currency: "TRY",
    isAvailable: true,
  },
] as const;

const CONTEXT = {
  revision: 3,
  isSignedIn: false,
  isOffline: false,
  isRefreshing: false,
  checkedAt: NOW - 20 * 60_000,
  limits: {},
  plans: { status: "ready", offers: [...OFFERS] },
  purchase: null,
} as const;

const of = (
  activity: Record<string, unknown>,
  context: Record<string, unknown> = {}
): SubscriptionState =>
  ({ ...CONTEXT, ...activity, ...context }) as SubscriptionState;

const trial = (
  days: number,
  context: Record<string, unknown> = {}
): SubscriptionState =>
  of(
    {
      status: "trial",
      trialEndsAt: NOW + days,
      licenseExpiresAt: NOW + 3 * DAY_MS,
    },
    context
  );
const EXPIRED = { status: "trial-expired", trialEndedAt: NOW - DAY_MS };
const PENDING = {
  purchase: { interval: "yearly", startedAt: NOW, expiresAt: NOW + 1_800_000 },
};

const GATE_STATES: Readonly<Record<string, SubscriptionState>> = {
  checking: of({ status: "loading" }),
  "trial-expired": of(EXPIRED),
  pending: of(EXPIRED, PENDING),
  "required-signed-in": of(
    { status: "subscription-required" },
    { isSignedIn: true }
  ),
  "required-no-plans": of(
    { status: "subscription-required" },
    { plans: { status: "ready", offers: [] } }
  ),
  "plans-loading": of(EXPIRED, { plans: { status: "loading", offers: [] } }),
  "plans-failed": of(EXPIRED, { plans: { status: "failed", offers: [] } }),
  mismatch: of(
    {
      status: "device-mismatch",
      boundDevice: { name: "Muhasebe-PC", os: "windows" },
    },
    { isSignedIn: true }
  ),
  offline: of(
    { status: "unavailable", reason: "offline" },
    { isOffline: true }
  ),
  clock: of({ status: "unavailable", reason: "clock" }),
};

// A client that always answers with one state: the components are drawn, not driven.
const clientOf = (state: SubscriptionState): SubscriptionClient => ({
  getState: () => state,
  subscribe: () => () => undefined,
  refresh: () => Promise.resolve(state),
  loadPlans: () => Promise.resolve(state),
  purchase: () => Promise.resolve(true),
  cancelPurchase: () => Promise.resolve(state),
  manage: () => Promise.resolve(true),
});

const TitleBar = (): ReactElement => (
  <div className="shot-titlebar">
    <span className="shot-titlebar__name">Notlar</span>
    <span className="shot-controls" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  </div>
);

const BANNERS: readonly (readonly [string, SubscriptionState])[] = [
  ["trial, 7 days", trial(7 * DAY_MS - 60_000)],
  ["trial, 2 days", trial(2 * DAY_MS - 60_000)],
  ["trial, last day", trial(5 * 3_600_000)],
  ["trial, purchase pending", trial(5 * DAY_MS, PENDING)],
];

const STATUSES: readonly (readonly [string, SubscriptionState])[] = [
  ["trial", trial(5 * DAY_MS)],
  [
    "subscribed, yearly",
    of(
      {
        status: "subscribed",
        plan: "yearly",
        licenseExpiresAt: NOW + 3 * DAY_MS,
      },
      { isSignedIn: true }
    ),
  ],
  [
    "subscribed, monthly, offline",
    of(
      {
        status: "subscribed",
        plan: "monthly",
        licenseExpiresAt: NOW + 2 * DAY_MS,
      },
      { isSignedIn: true, isOffline: true }
    ),
  ],
  ["trial expired", of(EXPIRED)],
  [
    "no decision (clock)",
    of({ status: "unavailable", reason: "clock" }, { checkedAt: null }),
  ],
];

const Parts = (): ReactElement => (
  <main className="shot-sheet">
    <section className="shot-column">
      <h2>TrialBanner</h2>
      {BANNERS.map(([name, state]) => (
        <div key={name} className="shot-column">
          <span className="shot-label">{name}</span>
          <TrialBanner client={clientOf(state)} />
        </div>
      ))}
    </section>
    <section className="shot-column">
      <h2>SubscriptionStatus</h2>
      {STATUSES.map(([name, state]) => (
        <div key={name} className="shot-column">
          <span className="shot-label">{name}</span>
          <div className="shot-card">
            <SubscriptionStatus client={clientOf(state)} />
          </div>
        </div>
      ))}
    </section>
  </main>
);

// A program during its trial: the banner on top, the status on its settings page.
const Program = (): ReactElement => {
  const client = clientOf(
    trial(5 * DAY_MS + 3_600_000, { limits: { notes: 100 } })
  );
  return (
    <SubscriptionGate client={client} productName="Notlar">
      <TitleBar />
      <main className="shot-program">
        <TrialBanner client={client} />
        <h1>Ayarlar</h1>
        <section className="shot-card">
          <h2>Abonelik</h2>
          <SubscriptionStatus client={client} />
        </section>
      </main>
    </SubscriptionGate>
  );
};

const Gate = ({ name }: { name: string }): ReactElement => {
  const state = GATE_STATES[name];
  if (state === undefined) throw new Error(`no gate scene called "${name}"`);
  return (
    <SubscriptionGate
      client={clientOf(state)}
      productName="Notlar"
      titleBar={<TitleBar />}
      onSignIn={() => undefined}
    >
      <main className="shot-program">
        <h1>Notlar</h1>
        <button type="button">Yeni not</button>
      </main>
    </SubscriptionGate>
  );
};

const [scene = "parts", theme = "light"] = location.search.slice(1).split("/");
document.documentElement.dataset["theme"] = theme;

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no root");
createRoot(root).render(
  scene === "parts" ? (
    <Parts />
  ) : scene === "program" ? (
    <Program />
  ) : (
    <Gate name={scene.replace("gate-", "")} />
  )
);
