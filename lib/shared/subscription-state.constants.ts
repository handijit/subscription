import type {
  PlanInterval,
  SubscriptionPlans,
  SubscriptionStatus,
  UnavailableReason,
} from "../types";

/** Every status, from undecided over licensed to the ones that block the program. */
const SUBSCRIPTION_STATUSES = [
  "loading",
  "trial",
  "subscribed",
  "trial-expired",
  "subscription-required",
  "device-mismatch",
  "unavailable",
] as const satisfies readonly SubscriptionStatus[];

/** Every reason the `unavailable` status gives. */
const UNAVAILABLE_REASONS = [
  "offline",
  "service",
  "clock",
  "update-required",
  "license-invalid",
  "unsupported-platform",
] as const satisfies readonly UnavailableReason[];

/** The two plans a program is sold on, monthly first. */
const PLAN_INTERVALS = [
  "monthly",
  "yearly",
] as const satisfies readonly PlanInterval[];

/** Every status of the plan list. */
const PLANS_STATUSES = [
  "idle",
  "loading",
  "ready",
  "failed",
] as const satisfies readonly SubscriptionPlans["status"][];

export {
  PLAN_INTERVALS,
  PLANS_STATUSES,
  SUBSCRIPTION_STATUSES,
  UNAVAILABLE_REASONS,
};
