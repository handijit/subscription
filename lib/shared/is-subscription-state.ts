import type { SubscriptionState } from "../types";
import {
  PLAN_INTERVALS,
  PLANS_STATUSES,
  UNAVAILABLE_REASONS,
} from "./subscription-state.constants";

type Shape = Readonly<Record<string, unknown>>;

const isShape = (value: unknown): value is Shape =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isFlag = (value: unknown): value is boolean => typeof value === "boolean";
const isNullOr = (
  value: unknown,
  check: (value: unknown) => boolean
): boolean => value === null || check(value);
const isOneOf = (list: readonly string[], value: unknown): boolean =>
  isText(value) && list.includes(value);

const isOffer = (value: unknown): boolean =>
  isShape(value) &&
  isOneOf(PLAN_INTERVALS, value.interval) &&
  isCount(value.priceKurus) &&
  isText(value.currency) &&
  isFlag(value.isAvailable);

const isPlans = (value: unknown): boolean =>
  isShape(value) &&
  isOneOf(PLANS_STATUSES, value.status) &&
  Array.isArray(value.offers) &&
  value.offers.every(isOffer);

const isPurchase = (value: unknown): boolean =>
  isShape(value) &&
  isOneOf(PLAN_INTERVALS, value.interval) &&
  isCount(value.startedAt) &&
  isCount(value.expiresAt);

const isLimits = (value: unknown): boolean =>
  isShape(value) && Object.values(value).every(Number.isSafeInteger);

const isDevice = (value: unknown): boolean =>
  isShape(value) && isNullOr(value.name, isText) && isNullOr(value.os, isText);

// What each status adds to the common fields.
const ACTIVITIES: Readonly<Record<string, (state: Shape) => boolean>> = {
  loading: () => true,
  trial: ({ trialEndsAt, licenseExpiresAt }) =>
    isCount(trialEndsAt) && isCount(licenseExpiresAt),
  subscribed: ({ plan, licenseExpiresAt }) =>
    isOneOf(PLAN_INTERVALS, plan) && isCount(licenseExpiresAt),
  "trial-expired": ({ trialEndedAt }) => isNullOr(trialEndedAt, isCount),
  "subscription-required": () => true,
  "device-mismatch": ({ boundDevice }) => isDevice(boundDevice),
  unavailable: ({ reason }) => isOneOf(UNAVAILABLE_REASONS, reason),
};

/**
 * Whether a value is a complete subscription state. The renderer checks what arrives over IPC
 * with it, without Zod: main validates with the schemas, the page with this.
 */
const isSubscriptionState = (value: unknown): value is SubscriptionState => {
  if (!isShape(value) || !isText(value.status)) return false;
  // Looked up without walking the prototype chain: "constructor" is not a status.
  const activity = Object.hasOwn(ACTIVITIES, value.status)
    ? ACTIVITIES[value.status]
    : undefined;

  return (
    activity !== undefined &&
    activity(value) &&
    isCount(value.revision) &&
    isFlag(value.isSignedIn) &&
    isFlag(value.isOffline) &&
    isFlag(value.isRefreshing) &&
    isNullOr(value.checkedAt, isCount) &&
    isLimits(value.limits) &&
    isPlans(value.plans) &&
    isNullOr(value.purchase, isPurchase)
  );
};

export default isSubscriptionState;
