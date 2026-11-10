import { hostname } from "node:os";

import { licenseResponseSchema } from "@handijit/core";
import type { IssueLicenseRequest, LicenseResponse } from "@handijit/core";
import {
  hasErrorCode,
  isApiError,
  isRateLimited,
  isTrialExpired,
  isUnauthorized,
} from "@handijit/core/errors";
import {
  PRODUCTION_LICENSE_KEYS,
  evaluateClockSkew,
  hashDeviceId,
  verifyLicense,
} from "@handijit/core/license";
import type { LicenseClaims } from "@handijit/core/license";
import { isVersion } from "@handijit/core/version";
import { createSecretStore } from "@handijit/electron/main";
import { app, powerMonitor, shell } from "electron";

import { PLAN_INTERVALS } from "../shared/subscription-state.constants";
import type {
  PendingPurchase,
  PlanInterval,
  SubscriptionActivity,
  SubscriptionPlans,
  SubscriptionState,
  UnavailableReason,
} from "../types";
import resolveDeviceId, { DEVICE_ID_PATTERN } from "./device-id";
import { EMPTY_RECORD, readRecord, writeRecord } from "./license-store";
import type { LicenseRecord } from "./license-store";
import { plansResponseSchema, toPlanOffers } from "./plans.helper";
import SubscriptionAccessError from "./subscription-access-error";
import type {
  AccessCheck,
  Subscription,
  SubscriptionAuthState,
  SubscriptionLogger,
  SubscriptionOptions,
  SubscriptionSecretStore,
} from "./types";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

const DEFAULT_REFRESH_INTERVAL_MS = 6 * HOUR_MS;
const DEFAULT_PURCHASE_TIMEOUT_MS = 30 * MINUTE_MS;
// A timer cannot wait longer than 2^31 ms; a day is more than any wait here needs.
const MAX_TIMER_MS = 24 * HOUR_MS;
const MAX_SETTING_MS = 7 * 24 * HOUR_MS;

// The backend allows 60 license requests in 10 minutes, per address and per customer. Clicks,
// focus changes and the renderer's "online" hint are folded into at most one request per gap.
const MIN_REFRESH_GAP_MS = 2 * SECOND_MS;
const FOCUS_GAP_BLOCKED_MS = 30 * SECOND_MS;
const FOCUS_GAP_LICENSED_MS = 15 * MINUTE_MS;
const RESUME_GAP_MS = MINUTE_MS;
const DEFAULT_RATE_LIMIT_PAUSE_SECONDS = 600;

// Without the backend: again after 30 s, 1, 2, 5 and then every 15 minutes, with jitter so
// that an office's programs do not knock at the same second.
const RETRY_DELAYS_MS = [30, 60, 120, 300, 900].map((s) => s * SECOND_MS);
// While a purchase is pending: after 5, 10, 15, 20 and then every 30 seconds.
const POLL_DELAYS_MS = [5, 10, 15, 20, 30].map((s) => s * SECOND_MS);

// How far the clock may go back before the stored license stops being trusted, and how far it
// may be off against a license's own times.
const CLOCK_TOLERANCE_MS = 5 * MINUTE_MS;
const CLOCK_TOLERANCE_SECONDS = CLOCK_TOLERANCE_MS / SECOND_MS;
// The latest moment seen is written down at most this often while nothing else changes.
const SEEN_SAVE_GAP_MS = 10 * MINUTE_MS;
const PLANS_TTL_MS = HOUR_MS;

const DEFAULT_PANEL_BASE_URL = "https://www.handijit.com";
const SUBSCRIPTION_PAGE_PATH = "/panel/hesabim/abonelik";
const PAID_LICENSE_PATH = "/api/customer/licenses";
const PRODUCT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PRODUCT_LENGTH = 64;
const MAX_DEVICE_NAME_LENGTH = 100;
const LOCAL_HOST_SUFFIX = /\.local$/i;

const OPERATING_SYSTEMS: Readonly<Record<string, "windows" | "macos">> = {
  win32: "windows",
  darwin: "macos",
};
const ARCHITECTURES: Readonly<Record<string, "x64" | "arm64">> = {
  x64: "x64",
  arm64: "arm64",
};

const UPDATE_REQUIRED_REASONS = new Set([
  "unknown-key",
  "unsupported-algorithm",
  "unsupported-type",
]);
const CLOCK_REASONS = new Set(["expired", "not-yet-valid"]);
// The statuses whose interface offers the plans.
const SHOWS_PRICES = new Set([
  "trial",
  "trial-expired",
  "subscription-required",
  "device-mismatch",
]);

type Refusal = Extract<
  SubscriptionActivity,
  { status: "trial-expired" | "subscription-required" | "device-mismatch" }
>;
type Held = {
  readonly token: string;
  readonly claims: LicenseClaims;
  readonly userId: number | null;
};
type Mode = "full" | "poll";
type Outcome =
  | {
      kind: "license";
      token: string;
      claims: LicenseClaims;
      userId: number | null;
      kid: string;
      at: number;
    }
  | { kind: "rejected-license"; reason: UnavailableReason; detail: string }
  | { kind: "refused"; refusal: Refusal; trialEndedAt: number | null }
  | {
      kind: "failed";
      reason: "offline" | "service";
      retryAfterMs: number | null;
      detail: Readonly<Record<string, unknown>>;
    }
  | { kind: "none" };
type Attempt =
  | { kind: "answer"; response: LicenseResponse }
  | { kind: "refused"; error: unknown }
  | { kind: "failed"; outcome: Extract<Outcome, { kind: "failed" }> };

const SILENT_LOGGER: SubscriptionLogger = {
  info: () => undefined,
  warn: () => undefined,
};

// A duration that is out of range is a wrong setting, not a reason to crash: the default applies.
const durationOr = (
  value: number | undefined,
  minimum: number,
  fallback: number
): number =>
  value !== undefined &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= MAX_SETTING_MS
    ? value
    : fallback;

// https everywhere; plain http only towards this computer (a test server).
const requireWebUrl = (value: string, option: string): string => {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  const isLoopback =
    url?.hostname === "127.0.0.1" || url?.hostname === "localhost";
  if (
    url === undefined ||
    url.username !== "" ||
    url.password !== "" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
  ) {
    throw new TypeError(
      `createSubscription: options.${option} must be an https URL, received ${JSON.stringify(value)}`
    );
  }
  return url.origin;
};

const later = (run: () => void, delayMs: number): NodeJS.Timeout => {
  const timer = setTimeout(run, Math.max(0, Math.min(delayMs, MAX_TIMER_MS)));
  // The schedule never keeps a quitting program alive.
  timer.unref();
  return timer;
};

const defaultDeviceName = (): string | undefined => {
  const name = hostname()
    .replace(LOCAL_HOST_SUFFIX, "")
    .trim()
    .slice(0, MAX_DEVICE_NAME_LENGTH);
  return name === "" ? undefined : name;
};

const defaultOpenExternal = async (url: string): Promise<boolean> => {
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
};

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

// `boundDevice: { name, os }` of a 409; whatever is missing stays unknown.
const boundDeviceOf = (
  extensions: Readonly<Record<string, unknown>>
): { name: string | null; os: string | null } => {
  const device = extensions.boundDevice;
  if (typeof device !== "object" || device === null) {
    return { name: null, os: null };
  }
  const { name, os } = device as Record<string, unknown>;
  return { name: textOrNull(name), os: textOrNull(os) };
};

const momentOf = (iso: unknown): number | null => {
  const moment = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(moment) ? moment : null;
};

// Only what helps a developer: never the license, a token or the device id.
const describeFailure = (error: unknown): Readonly<Record<string, unknown>> =>
  isApiError(error)
    ? {
        kind: error.kind,
        ...("status" in error ? { status: error.status } : {}),
        ...("code" in error && error.code !== undefined
          ? { code: error.code }
          : {}),
      }
    : { kind: "internal" };

/**
 * Creates the subscription of a program: an explicit state machine over the license the backend
 * issues. It decides in main what the program may do (a trial bound to the device, then a paid
 * subscription bound to one device), keeps that decision working offline until the license's
 * own expiry, and never beyond.
 *
 * Nothing happens until `start()`. No method rejects because of the network, the backend or
 * the store: failures are part of the state. Throws a `TypeError` for a setting that can only
 * be a programming error.
 */
const createSubscription = (options: SubscriptionOptions): Subscription => {
  const { product, auth } = options;
  if (
    typeof product !== "string" ||
    product.length > MAX_PRODUCT_LENGTH ||
    !PRODUCT_PATTERN.test(product)
  ) {
    throw new TypeError(
      `createSubscription: options.product must be the product's slug, like "on-muhasebe", received ${JSON.stringify(product)}`
    );
  }
  if (
    typeof auth !== "object" ||
    auth === null ||
    typeof auth.getState !== "function"
  ) {
    throw new TypeError(
      "createSubscription: options.auth must be the program's createAuth(...) instance"
    );
  }
  const appVersion = options.appVersion ?? app.getVersion();
  if (!isVersion(appVersion)) {
    throw new TypeError(
      `createSubscription: options.appVersion must be a version like "1.4.0", received ${JSON.stringify(appVersion)}`
    );
  }
  if (
    options.deviceId !== undefined &&
    !DEVICE_ID_PATTERN.test(options.deviceId)
  ) {
    throw new TypeError(
      "createSubscription: options.deviceId must be 32-128 characters of A-Z, a-z, 0-9, _ or -"
    );
  }
  const keys = options.keys ?? PRODUCTION_LICENSE_KEYS;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new TypeError(
      "createSubscription: options.keys must list at least one license key"
    );
  }
  const panelBaseUrl = requireWebUrl(
    options.panelBaseUrl ?? DEFAULT_PANEL_BASE_URL,
    "panelBaseUrl"
  );
  const logger = options.logger ?? SILENT_LOGGER;
  const openExternal = options.openExternal ?? defaultOpenExternal;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const refreshIntervalMs = durationOr(
    options.refreshIntervalMs,
    MINUTE_MS,
    DEFAULT_REFRESH_INTERVAL_MS
  );
  const purchaseTimeoutMs = durationOr(
    options.purchaseTimeoutMs,
    MINUTE_MS,
    DEFAULT_PURCHASE_TIMEOUT_MS
  );
  const os = OPERATING_SYSTEMS[options.platform ?? process.platform];
  const arch = ARCHITECTURES[options.arch ?? process.arch];
  const deviceName = (options.deviceName ?? defaultDeviceName())
    ?.trim()
    .slice(0, MAX_DEVICE_NAME_LENGTH);

  const listeners = new Set<(state: SubscriptionState) => void>();
  let state: SubscriptionState = Object.freeze<SubscriptionState>({
    status: "loading",
    revision: 0,
    isSignedIn: false,
    isOffline: false,
    isRefreshing: false,
    checkedAt: null,
    limits: {},
    plans: { status: "idle", offers: [] },
    purchase: null,
  });
  let fingerprint = "";

  let store: SubscriptionSecretStore | undefined;
  let deviceId: string | null = null;
  let deviceHash: string | null = null;
  let held: Held | null = null;
  let refusal: Refusal | null = null;
  let failure: UnavailableReason | null = null;
  let trialEndedAt: number | null = null;
  let isClockBroken = false;
  let latestSeenAt = 0;
  let savedSeenAt = 0;
  let hasDecided = false;
  let isOffline = false;
  let isRefreshing = false;
  let checkedAt: number | null = null;
  let plans: SubscriptionPlans = { status: "idle", offers: [] };
  let plansLoadedAt = Number.NEGATIVE_INFINITY;
  let purchase: PendingPurchase | null = null;
  let pollIndex = 0;
  let userKey: number | null = null;
  let generation = 0;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let pausedUntil = Number.NEGATIVE_INFINITY;
  let failureCount = 0;
  let isDisposed = false;
  let hasWarnedStore = false;
  let startRun: Promise<SubscriptionState> | undefined;
  let inflight: Promise<SubscriptionState> | null = null;
  let plansRun: Promise<SubscriptionState> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let refreshTimer: NodeJS.Timeout | undefined;
  let expiryTimer: NodeJS.Timeout | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  let stopAuth: (() => void) | undefined;
  let detachSystem: (() => void) | undefined;

  const isSupported = os !== undefined && arch !== undefined;

  // --- the clock guard -------------------------------------------------------------------

  const save = (): Promise<void> => {
    const target = store;
    if (target === undefined) return saving;
    const record: LicenseRecord = {
      version: 1,
      license: held?.token ?? null,
      userId: held?.userId ?? null,
      trialEndedAt,
      latestSeenAt,
    };
    savedSeenAt = latestSeenAt;
    saving = saving
      .then(() => writeRecord(target, record))
      .catch(() => {
        if (hasWarnedStore) return;
        hasWarnedStore = true;
        logger.warn(
          "subscription: the license could not be stored; it is kept in memory until the program quits"
        );
      });
    return saving;
  };

  // The latest moment seen only moves forward. A clock that is earlier than it by more than
  // the tolerance was turned back: the held license stops counting until a fresh one verifies.
  const observe = (moment: number): void => {
    if (moment + CLOCK_TOLERANCE_MS < latestSeenAt) {
      if (!isClockBroken) {
        logger.warn("subscription: the clock was turned back", {
          behindMs: latestSeenAt - moment,
        });
      }
      isClockBroken = true;
      return;
    }
    latestSeenAt = Math.max(latestSeenAt, moment);
    if (hasDecided && latestSeenAt - savedSeenAt >= SEEN_SAVE_GAP_MS) {
      void save();
    }
  };

  // --- the state ---------------------------------------------------------------------------

  const activityAt = (moment: number): SubscriptionActivity => {
    if (!isSupported) {
      return { status: "unavailable", reason: "unsupported-platform" };
    }
    if (!hasDecided) return { status: "loading" };
    if (isClockBroken) return { status: "unavailable", reason: "clock" };
    if (held !== null && moment < held.claims.exp * SECOND_MS) {
      const licenseExpiresAt = held.claims.exp * SECOND_MS;
      return held.claims.plan === "trial"
        ? {
            status: "trial",
            trialEndsAt:
              (held.claims.trialEndsAt ?? held.claims.exp) * SECOND_MS,
            licenseExpiresAt,
          }
        : { status: "subscribed", plan: held.claims.plan, licenseExpiresAt };
    }
    if (refusal !== null) return refusal;
    // A trial that is known to be over needs no backend to say so, as long as nobody is
    // signed in who might hold a subscription.
    const heldTrialEnd =
      held?.claims.plan === "trial" &&
      held.claims.trialEndsAt !== undefined &&
      held.claims.trialEndsAt * SECOND_MS <= moment
        ? held.claims.trialEndsAt * SECOND_MS
        : null;
    const trialEnd = heldTrialEnd ?? trialEndedAt;
    if (trialEnd !== null && userKey === null) {
      return { status: "trial-expired", trialEndedAt: trialEnd };
    }
    if (failure !== null) return { status: "unavailable", reason: failure };
    return isRefreshing || lastAttemptAt === Number.NEGATIVE_INFINITY
      ? { status: "loading" }
      : { status: "unavailable", reason: "offline" };
  };

  const isLicensed = (activity: SubscriptionActivity): boolean =>
    activity.status === "trial" || activity.status === "subscribed";

  const publish = (): SubscriptionState => {
    const moment = now();
    observe(moment);
    const activity = activityAt(moment);
    if (activity.status === "subscribed" && purchase !== null) {
      purchase = null;
      clearTimeout(pollTimer);
    }
    const next = {
      ...activity,
      isSignedIn: userKey !== null,
      isOffline,
      isRefreshing,
      checkedAt,
      limits: isLicensed(activity) && held !== null ? held.claims.limits : {},
      plans,
      purchase,
    };
    const print = JSON.stringify(next);
    if (print === fingerprint) return state;
    fingerprint = print;
    state = Object.freeze({
      ...next,
      limits: Object.freeze({ ...next.limits }),
      revision: state.revision + 1,
    });
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        logger.warn("subscription: a state listener threw", {
          error: String(error),
        });
      }
    }
    // The paywall shows prices: they are read as soon as the program is not on a paid plan.
    if (plans.status === "idle" && SHOWS_PRICES.has(activity.status)) {
      queueMicrotask(() => void loadPlans());
    }
    return state;
  };

  // --- asking the backend ------------------------------------------------------------------

  const requestBody = (id: string): IssueLicenseRequest => ({
    product,
    deviceId: id,
    ...(deviceName === undefined || deviceName === "" ? {} : { deviceName }),
    // `isSupported` was checked before any request is built.
    os: os as "windows" | "macos",
    arch: arch as "x64" | "arm64",
    appVersion,
  });

  const failedOutcome = (
    error: unknown
  ): Extract<Outcome, { kind: "failed" }> => {
    const isNetwork =
      isApiError(error) &&
      (error.kind === "network" ||
        error.kind === "timeout" ||
        error.kind === "aborted");
    return {
      kind: "failed",
      reason: isNetwork ? "offline" : "service",
      retryAfterMs: isRateLimited(error)
        ? (error.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_PAUSE_SECONDS) *
          SECOND_MS
        : null,
      detail: describeFailure(error),
    };
  };

  const attempt = async (
    send: () => Promise<LicenseResponse>,
    isRefusal: (error: unknown) => boolean
  ): Promise<Attempt> => {
    try {
      return { kind: "answer", response: await send() };
    } catch (error) {
      return isRefusal(error)
        ? { kind: "refused", error }
        : { kind: "failed", outcome: failedOutcome(error) };
    }
  };

  const isPaidRefusal = (error: unknown): boolean =>
    hasErrorCode(error, "SUBSCRIPTION_REQUIRED") ||
    hasErrorCode(error, "SUBSCRIPTION_DEVICE_MISMATCH") ||
    isUnauthorized(error);
  const isTrialRefusal = (error: unknown): boolean =>
    hasErrorCode(error, "TRIAL_EXPIRED") ||
    hasErrorCode(error, "TRIAL_NOT_AVAILABLE");

  // The license is checked here, in main, before anything in it counts: signature against
  // the built-in keys, product, device, issue and expiry times.
  const accept = async (
    response: LicenseResponse,
    userId: number | null
  ): Promise<Outcome> => {
    const at = now();
    const verification = await verifyLicense(response.license, {
      keys,
      product,
      deviceHash: deviceHash as string,
      now: at,
      clockToleranceSeconds: CLOCK_TOLERANCE_SECONDS,
    });
    if (verification.ok) {
      return {
        kind: "license",
        token: response.license,
        claims: verification.claims,
        userId: verification.claims.plan === "trial" ? null : userId,
        kid: verification.kid,
        at,
      };
    }
    const { reason, detail } = verification;
    if (UPDATE_REQUIRED_REASONS.has(reason)) {
      return { kind: "rejected-license", reason: "update-required", detail };
    }
    const isClockOff =
      CLOCK_REASONS.has(reason) &&
      evaluateClockSkew(response.serverTime, {
        now: at,
        toleranceSeconds: CLOCK_TOLERANCE_SECONDS,
      }).status !== "in-sync";
    return {
      kind: "rejected-license",
      reason: isClockOff ? "clock" : "license-invalid",
      detail,
    };
  };

  const refusalOf = (
    paidError: unknown,
    trialError: unknown
  ): Extract<Outcome, { kind: "refused" }> => {
    const ended = isTrialExpired(trialError)
      ? momentOf(trialError.extensions.trialEndedAt)
      : null;
    if (hasErrorCode(paidError, "SUBSCRIPTION_DEVICE_MISMATCH")) {
      return {
        kind: "refused",
        refusal: {
          status: "device-mismatch",
          boundDevice: boundDeviceOf(paidError.extensions),
        },
        trialEndedAt: ended,
      };
    }
    if (
      !hasErrorCode(paidError, "SUBSCRIPTION_REQUIRED") &&
      hasErrorCode(trialError, "TRIAL_EXPIRED")
    ) {
      return {
        kind: "refused",
        refusal: { status: "trial-expired", trialEndedAt: ended },
        trialEndedAt: ended,
      };
    }
    return {
      kind: "refused",
      refusal: { status: "subscription-required" },
      trialEndedAt: ended,
    };
  };

  const obtain = async (mode: Mode, user: number | null): Promise<Outcome> => {
    const body = requestBody(deviceId as string);
    const issueTrial = (): Promise<Attempt> =>
      attempt(() => auth.client.issueLicense(body), isTrialRefusal);
    if (user !== null) {
      const paid = await attempt(
        () =>
          auth.client.request({
            method: "POST",
            path: PAID_LICENSE_PATH,
            body,
            auth: true,
            schema: licenseResponseSchema,
          }),
        isPaidRefusal
      );
      if (paid.kind === "answer") return accept(paid.response, user);
      // While a purchase is pending only a paid license is news: the trial stays as it is.
      if (mode === "poll") return { kind: "none" };
      if (paid.kind === "failed") return paid.outcome;
      // No subscription for this device (yet): a running trial still counts.
      const trial = await issueTrial();
      if (trial.kind === "answer") return accept(trial.response, null);
      return refusalOf(
        paid.error,
        trial.kind === "refused" ? trial.error : null
      );
    }
    const trial = await issueTrial();
    if (trial.kind === "answer") return accept(trial.response, null);
    if (trial.kind === "failed") return trial.outcome;
    return refusalOf(null, trial.error);
  };

  const apply = (outcome: Outcome, mode: Mode): void => {
    if (outcome.kind === "none") return;
    const at = now();
    if (outcome.kind === "failed") {
      failure = outcome.reason;
      isOffline = outcome.reason === "offline";
      failureCount += 1;
      if (outcome.retryAfterMs !== null) {
        pausedUntil = at + outcome.retryAfterMs;
      }
      logger.warn("subscription: the license request failed", outcome.detail);
      return;
    }
    isOffline = false;
    checkedAt = at;
    if (outcome.kind === "rejected-license") {
      failure = outcome.reason;
      failureCount += 1;
      if (outcome.reason === "clock") isClockBroken = true;
      logger.warn("subscription: the issued license was not accepted", {
        reason: outcome.reason,
        detail: outcome.detail,
      });
      return;
    }
    failureCount = 0;
    if (outcome.kind === "refused") {
      if (mode === "full") held = null;
      refusal = outcome.refusal;
      failure = null;
      trialEndedAt = outcome.trialEndedAt ?? trialEndedAt;
      logger.info("subscription: no license for this installation", {
        status: outcome.refusal.status,
      });
      void save();
      return;
    }
    held = {
      token: outcome.token,
      claims: outcome.claims,
      userId: outcome.userId,
    };
    refusal = null;
    failure = null;
    // A license that verified against the backend's own time proves the clock: whatever an
    // earlier, wrong clock wrote down is forgotten.
    isClockBroken = false;
    latestSeenAt = outcome.at;
    if (outcome.claims.plan === "trial") trialEndedAt = null;
    logger.info("subscription: license issued", {
      plan: outcome.claims.plan,
      kid: outcome.kid,
      expiresAt: new Date(outcome.claims.exp * SECOND_MS).toISOString(),
    });
    void save();
  };

  // --- the schedule ------------------------------------------------------------------------

  const jitter = (delay: number): number => delay * (0.8 + random() * 0.4);

  const scheduleExpiry = (): void => {
    clearTimeout(expiryTimer);
    if (held === null || isDisposed) return;
    const left = held.claims.exp * SECOND_MS - now();
    if (left <= 0) return;
    expiryTimer = later(() => {
      publish();
      if (held !== null && now() >= held.claims.exp * SECOND_MS) {
        void run("full", true);
      } else {
        scheduleExpiry();
      }
    }, left + 500);
  };

  const scheduleRefresh = (): void => {
    clearTimeout(refreshTimer);
    if (isDisposed) return;
    const at = now();
    let delay =
      failure !== null && failureCount > 0
        ? jitter(
            RETRY_DELAYS_MS[
              Math.min(failureCount, RETRY_DELAYS_MS.length) - 1
            ] ?? refreshIntervalMs
          )
        : refreshIntervalMs;
    if (held !== null) {
      // Renew while the license still has half its life: a short outage never ends it.
      const left = held.claims.exp * SECOND_MS - at;
      delay = Math.min(delay, Math.max(MINUTE_MS, left / 2));
    }
    delay = Math.max(delay, pausedUntil - at);
    refreshTimer = later(() => void run("full", true), delay);
    scheduleExpiry();
  };

  const canRequest = (): boolean =>
    isSupported && !isDisposed && startRun !== undefined && deviceId !== null;

  const execute = async (mode: Mode): Promise<SubscriptionState | null> => {
    const runGeneration = generation;
    lastAttemptAt = now();
    if (mode === "full") {
      isRefreshing = true;
      publish();
    }
    let outcome: Outcome;
    try {
      outcome = await obtain(mode, userKey);
    } catch (error) {
      outcome = failedOutcome(error);
    }
    isRefreshing = false;
    if (isDisposed) return publish();
    // The session changed while the request was on its way: its answer belongs to the other
    // customer, so it is dropped and the license is asked for again.
    if (runGeneration !== generation) return null;
    apply(outcome, mode);
    if (mode === "full" || outcome.kind === "license") scheduleRefresh();
    return publish();
  };

  const run = (mode: Mode, isForced: boolean): Promise<SubscriptionState> => {
    if (!canRequest()) return Promise.resolve(publish());
    if (inflight !== null) return inflight;
    const at = now();
    if (
      at < pausedUntil ||
      (!isForced && at - lastAttemptAt < MIN_REFRESH_GAP_MS) ||
      (mode === "poll" && userKey === null)
    ) {
      return Promise.resolve(publish());
    }
    const current = execute(mode).then((result) => {
      inflight = null;
      return result ?? run("full", true);
    });
    inflight = current;
    return current;
  };

  // --- the purchase ------------------------------------------------------------------------

  const schedulePoll = (): void => {
    clearTimeout(pollTimer);
    if (purchase === null || isDisposed) return;
    const left = purchase.expiresAt - now();
    if (left <= 0) {
      logger.info("subscription: stopped waiting for the purchase");
      purchase = null;
      publish();
      return;
    }
    const delay =
      POLL_DELAYS_MS[Math.min(pollIndex, POLL_DELAYS_MS.length - 1)] ??
      MINUTE_MS;
    pollTimer = later(() => void poll(), Math.min(delay, left));
  };

  const poll = async (): Promise<void> => {
    if (purchase === null) return;
    pollIndex += 1;
    await run("poll", true);
    schedulePoll();
  };

  const subscriptionPageUrl = (interval?: PlanInterval): string => {
    const url = new URL(SUBSCRIPTION_PAGE_PATH, panelBaseUrl);
    url.searchParams.set("product", product);
    if (interval !== undefined) url.searchParams.set("interval", interval);
    return url.toString();
  };

  const open = async (url: string): Promise<boolean> => {
    try {
      return (await openExternal(url)) === true;
    } catch {
      return false;
    }
  };

  const purchaseFor = async (interval: PlanInterval): Promise<boolean> => {
    if (!PLAN_INTERVALS.includes(interval)) {
      throw new TypeError(
        `subscription.purchase: interval must be "monthly" or "yearly", received ${JSON.stringify(interval)}`
      );
    }
    const isOpened = await open(subscriptionPageUrl(interval));
    if (!isOpened || isDisposed) return isOpened;
    if (state.status !== "subscribed") {
      const at = now();
      purchase = { interval, startedAt: at, expiresAt: at + purchaseTimeoutMs };
      pollIndex = 0;
      publish();
      schedulePoll();
    }
    return true;
  };

  const cancelPurchase = (): SubscriptionState => {
    clearTimeout(pollTimer);
    purchase = null;
    return publish();
  };

  // --- the plans ---------------------------------------------------------------------------

  const fetchPlans = async (): Promise<SubscriptionState> => {
    plans = { status: "loading", offers: plans.offers };
    publish();
    try {
      const list = await auth.client.request({
        method: "GET",
        path: `/api/public/products/${product}/plans`,
        schema: plansResponseSchema,
      });
      plans = { status: "ready", offers: toPlanOffers(list) };
      plansLoadedAt = now();
    } catch (error) {
      // A program that is not on sale (yet) has no plans; that is not a failure to show.
      if (hasErrorCode(error, "NOT_FOUND")) {
        plans = { status: "ready", offers: [] };
        plansLoadedAt = now();
      } else {
        plans = { status: "failed", offers: [] };
        logger.warn(
          "subscription: the plans could not be read",
          describeFailure(error)
        );
      }
    }
    return publish();
  };

  const loadPlans = (): Promise<SubscriptionState> => {
    if (isDisposed) return Promise.resolve(state);
    if (plansRun !== null) return plansRun;
    if (plans.status === "ready" && now() - plansLoadedAt < PLANS_TTL_MS) {
      return Promise.resolve(publish());
    }
    const current = fetchPlans().finally(() => {
      plansRun = null;
    });
    plansRun = current;
    return current;
  };

  // --- the session and the system ----------------------------------------------------------

  // `undefined` while the session is in between (restoring, signing in): nothing changes yet.
  const userOf = (
    authState: SubscriptionAuthState
  ): number | null | undefined => {
    if (authState.status === "signed-in" && authState.user !== null) {
      return authState.user.id;
    }
    return authState.status === "signed-out" ? null : undefined;
  };

  const onAuthChange = (authState: SubscriptionAuthState): void => {
    const user = userOf(authState);
    if (user === undefined || user === userKey || isDisposed) return;
    userKey = user;
    generation += 1;
    // A paid license belongs to the customer it was issued to.
    if (held !== null && held.userId !== null && held.userId !== user) {
      held = null;
      void save();
    }
    if (refusal !== null && refusal.status !== "trial-expired") refusal = null;
    publish();
    if (hasDecided) void run("full", true);
  };

  const onFocus = (): void => {
    if (purchase !== null) {
      void poll();
      return;
    }
    const gap = isLicensed(publish())
      ? FOCUS_GAP_LICENSED_MS
      : FOCUS_GAP_BLOCKED_MS;
    if (now() - lastAttemptAt >= gap) void run("full", true);
  };

  const onResume = (): void => {
    publish();
    if (now() - lastAttemptAt >= RESUME_GAP_MS) void run("full", true);
  };

  const attachSystem = (): void => {
    app.on("browser-window-focus", onFocus);
    powerMonitor.on("resume", onResume);
    detachSystem = () => {
      app.removeListener("browser-window-focus", onFocus);
      powerMonitor.removeListener("resume", onResume);
    };
  };

  const restoreRecord = async (
    target: SubscriptionSecretStore,
    hash: string
  ): Promise<void> => {
    const record = await readRecord(target);
    latestSeenAt = record.latestSeenAt;
    savedSeenAt = record.latestSeenAt;
    trialEndedAt = record.trialEndedAt;
    const at = now();
    observe(at);
    if (record === EMPTY_RECORD || record.license === null) return;
    // A paid license is used only while its customer is signed in.
    if (record.userId !== null && record.userId !== userKey) return;
    const verification = await verifyLicense(record.license, {
      keys,
      product,
      deviceHash: hash,
      now: at,
      clockToleranceSeconds: CLOCK_TOLERANCE_SECONDS,
    });
    if (verification.ok) {
      held = {
        token: record.license,
        claims: verification.claims,
        userId: record.userId,
      };
      return;
    }
    if (
      verification.reason === "expired" &&
      verification.claims.plan === "trial" &&
      verification.claims.trialEndsAt !== undefined &&
      verification.claims.trialEndsAt * SECOND_MS <= at
    ) {
      trialEndedAt = verification.claims.trialEndsAt * SECOND_MS;
    }
  };

  const start = (): Promise<SubscriptionState> => {
    startRun ??= (async () => {
      if (!isSupported || isDisposed) return publish();
      stopAuth = auth.onChange(onAuthChange);
      try {
        await auth.restore().catch(() => undefined);
        userKey = userOf(auth.getState()) ?? null;
        const target = options.secretStore ?? createSecretStore();
        store = target;
        const id =
          options.deviceId ??
          (await resolveDeviceId({
            product,
            platform: options.platform ?? process.platform,
            store: target,
            logger,
          }));
        const hash = await hashDeviceId(id);
        await restoreRecord(target, hash);
        deviceId = id;
        deviceHash = hash;
      } catch (error) {
        failure = "service";
        logger.warn("subscription: the stored license could not be read", {
          error: String(error),
        });
      }
      hasDecided = true;
      if (isDisposed) return publish();
      void app
        .whenReady()
        .then(() => {
          if (!isDisposed) attachSystem();
        })
        .catch(() => undefined);
      scheduleExpiry();
      const decided = publish();
      void run("full", true);
      return decided;
    })();
    return startRun;
  };

  // --- access ------------------------------------------------------------------------------

  const check = (limit?: string, used = 0): AccessCheck => {
    if (limit !== undefined && typeof limit !== "string") {
      throw new TypeError(
        `subscription.check: limit must be a limit's name, received ${JSON.stringify(limit)}`
      );
    }
    if (!Number.isFinite(used) || used < 0) {
      throw new TypeError(
        `subscription.check: used must be a count of 0 or more, received ${String(used)}`
      );
    }
    const current = publish();
    if (!isLicensed(current) || held === null) {
      return {
        isAllowed: false,
        reason: "not-entitled",
        limit: limit ?? null,
        max: null,
      };
    }
    if (limit === undefined || !Object.hasOwn(current.limits, limit)) {
      return { isAllowed: true };
    }
    const max = current.limits[limit] as number;
    return used < max
      ? { isAllowed: true }
      : { isAllowed: false, reason: "limit-reached", limit, max };
  };

  const requireAccess = (limit?: string, used = 0): void => {
    const result = check(limit, used);
    if (result.isAllowed) return;
    throw new SubscriptionAccessError(
      result.reason === "not-entitled" ? "NOT_ENTITLED" : "LIMIT_REACHED",
      result.limit,
      result.max
    );
  };

  return {
    getState: () => state,
    onChange: (listener) => {
      // Each subscription is its own entry, so the same function may subscribe twice.
      const entry = (next: SubscriptionState): void => {
        listener(next);
      };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    start,
    refresh: () => run("full", false),
    isEntitled: () => isLicensed(publish()),
    check,
    require: requireAccess,
    loadPlans,
    purchase: purchaseFor,
    cancelPurchase,
    manage: () => open(subscriptionPageUrl()),
    dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      clearTimeout(refreshTimer);
      clearTimeout(expiryTimer);
      clearTimeout(pollTimer);
      stopAuth?.();
      detachSystem?.();
    },
  };
};

export default createSubscription;
