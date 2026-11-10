import type { SubscriptionActivity, SubscriptionState } from "../../lib/types";

const START = Date.UTC(2026, 10, 10, 8);
const DAY_MS = 24 * 60 * 60 * 1000;

const CONTEXT = {
  revision: 1,
  isSignedIn: false,
  isOffline: false,
  isRefreshing: false,
  checkedAt: START,
  limits: {},
  plans: { status: "idle", offers: [] },
  purchase: null,
} as const;

/** A state of the given activity, with the usual context unless the test overrides it. */
const stateOf = (
  activity: SubscriptionActivity,
  context: Partial<SubscriptionState> = {}
): SubscriptionState =>
  ({ ...CONTEXT, ...activity, ...context }) as SubscriptionState;

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

/** One state of every status, and some context variants. */
const VALID_STATES: readonly SubscriptionState[] = [
  stateOf({ status: "loading" }, { checkedAt: null, revision: 0 }),
  stateOf(
    {
      status: "trial",
      trialEndsAt: START + 5 * DAY_MS,
      licenseExpiresAt: START + 3 * DAY_MS,
    },
    {
      limits: { records: 100 },
      plans: { status: "ready", offers: [...OFFERS] },
    }
  ),
  stateOf(
    {
      status: "subscribed",
      plan: "yearly",
      licenseExpiresAt: START + 3 * DAY_MS,
    },
    { isSignedIn: true, isOffline: true }
  ),
  stateOf(
    { status: "trial-expired", trialEndedAt: START - DAY_MS },
    {
      plans: { status: "loading", offers: [] },
      purchase: {
        interval: "monthly",
        startedAt: START,
        expiresAt: START + 1_800_000,
      },
    }
  ),
  stateOf({ status: "trial-expired", trialEndedAt: null }),
  stateOf(
    { status: "subscription-required" },
    { isSignedIn: true, plans: { status: "failed", offers: [] } }
  ),
  stateOf(
    {
      status: "device-mismatch",
      boundDevice: { name: "Muhasebe-PC", os: "windows" },
    },
    { isSignedIn: true }
  ),
  stateOf({ status: "device-mismatch", boundDevice: { name: null, os: null } }),
  stateOf(
    { status: "unavailable", reason: "offline" },
    { isOffline: true, isRefreshing: true }
  ),
  stateOf({ status: "unavailable", reason: "clock" }),
];

const [LOADING, TRIAL] = VALID_STATES as [SubscriptionState, SubscriptionState];

/** Values that look like a state but are not, by name. */
const INVALID_STATES: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["array", []],
  ["no status", { ...CONTEXT }],
  ["unknown status", { ...CONTEXT, status: "paused" }],
  ["inherited status", { ...CONTEXT, status: "constructor" }],
  ["trial without end", { ...TRIAL, trialEndsAt: undefined }],
  ["trial with negative expiry", { ...TRIAL, licenseExpiresAt: -1 }],
  [
    "subscribed with unknown plan",
    { ...CONTEXT, status: "subscribed", plan: "weekly", licenseExpiresAt: 1 },
  ],
  [
    "trial-expired with text date",
    { ...CONTEXT, status: "trial-expired", trialEndedAt: "dün" },
  ],
  ["mismatch without device", { ...CONTEXT, status: "device-mismatch" }],
  [
    "mismatch with numeric name",
    {
      ...CONTEXT,
      status: "device-mismatch",
      boundDevice: { name: 7, os: null },
    },
  ],
  [
    "unavailable with unknown reason",
    { ...CONTEXT, status: "unavailable", reason: "tired" },
  ],
  ["negative revision", { ...LOADING, revision: -1 }],
  ["text sign-in", { ...LOADING, isSignedIn: "yes" }],
  ["missing offline", { ...LOADING, isOffline: undefined }],
  ["missing refreshing", { ...LOADING, isRefreshing: undefined }],
  ["infinite check", { ...LOADING, checkedAt: Number.POSITIVE_INFINITY }],
  ["fractional limit", { ...LOADING, limits: { records: 1.5 } }],
  ["limits list", { ...LOADING, limits: [1] }],
  [
    "unknown plans status",
    { ...LOADING, plans: { status: "maybe", offers: [] } },
  ],
  ["plans without list", { ...LOADING, plans: { status: "ready" } }],
  [
    "offer with unknown interval",
    {
      ...LOADING,
      plans: {
        status: "ready",
        offers: [{ ...OFFERS[0], interval: "weekly" }],
      },
    },
  ],
  [
    "offer with text price",
    {
      ...LOADING,
      plans: { status: "ready", offers: [{ ...OFFERS[0], priceKurus: "149" }] },
    },
  ],
  [
    "offer without currency",
    {
      ...LOADING,
      plans: { status: "ready", offers: [{ ...OFFERS[0], currency: 1 }] },
    },
  ],
  [
    "offer without availability",
    {
      ...LOADING,
      plans: {
        status: "ready",
        offers: [{ ...OFFERS[0], isAvailable: "yes" }],
      },
    },
  ],
  [
    "offer that is not an object",
    { ...LOADING, plans: { status: "ready", offers: [null] } },
  ],
  [
    "purchase with unknown plan",
    {
      ...LOADING,
      purchase: { interval: "weekly", startedAt: 1, expiresAt: 2 },
    },
  ],
  [
    "purchase without end",
    { ...LOADING, purchase: { interval: "monthly", startedAt: 1 } },
  ],
  ["purchase that is text", { ...LOADING, purchase: "monthly" }],
];

export { INVALID_STATES, OFFERS, START, VALID_STATES, stateOf };
