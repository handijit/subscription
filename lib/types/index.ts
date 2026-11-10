import type { ZodType } from "zod";

/** Where the installation stands with its license. */
type SubscriptionStatus =
  | "loading"
  | "trial"
  | "subscribed"
  | "trial-expired"
  | "subscription-required"
  | "device-mismatch"
  | "unavailable";

/** Why no decision could be reached (see the `unavailable` status). */
type UnavailableReason =
  | "offline"
  | "service"
  | "clock"
  | "update-required"
  | "license-invalid"
  | "unsupported-platform";

/** How often a subscription is paid. */
type PlanInterval = "monthly" | "yearly";

/** One plan of the program as the backend lists it. */
type PlanOffer = {
  /** How often the plan is paid. */
  readonly interval: PlanInterval;
  /** The price of one period in kuruş (1/100 of the currency unit). */
  readonly priceKurus: number;
  /** The ISO 4217 code of the currency; `TRY` today. */
  readonly currency: string;
  /** Whether the plan can be bought right now: payments are open and the plan is ready. */
  readonly isAvailable: boolean;
};

/** The program's plans, for display. They never decide anything. */
type SubscriptionPlans = {
  /** `idle` until they are asked for; `failed` when the backend could not be read. */
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** The plans, monthly first. Empty until `ready`, and when the program has none. */
  readonly offers: readonly PlanOffer[];
};

/** A purchase the customer started in the browser and has not finished yet. */
type PendingPurchase = {
  /** The plan the customer picked. */
  readonly interval: PlanInterval;
  /** When the browser was opened (epoch milliseconds). */
  readonly startedAt: number;
  /** When the program stops waiting for it (epoch milliseconds). */
  readonly expiresAt: number;
};

/** The installation a subscription is bound to, as the backend names it. */
type BoundDevice = {
  /** The name the customer knows the machine by; `null` when the backend has none. */
  readonly name: string | null;
  /** Its operating system (`windows`, `macos`); `null` when the backend did not say. */
  readonly os: string | null;
};

/** What the installation may do right now, and why. Exactly one of these at a time. */
type SubscriptionActivity =
  | {
      /** Nothing is decided yet: the stored license is being read or the first answer is on its way. */
      readonly status: "loading";
    }
  | {
      /** A verified trial license is in force. */
      readonly status: "trial";
      /** When the trial ends (epoch milliseconds). */
      readonly trialEndsAt: number;
      /** Until when the held license works without the backend (epoch milliseconds). */
      readonly licenseExpiresAt: number;
    }
  | {
      /** A verified license of a paid plan is in force. */
      readonly status: "subscribed";
      /** The plan of the subscription. */
      readonly plan: PlanInterval;
      /** Until when the held license works without the backend (epoch milliseconds). */
      readonly licenseExpiresAt: number;
    }
  | {
      /** The trial of this device is over and nobody with a subscription is signed in. */
      readonly status: "trial-expired";
      /** When the trial ended (epoch milliseconds); `null` when the backend did not say. */
      readonly trialEndedAt: number | null;
    }
  | {
      /**
       * No license without a subscription: the signed-in account has none that is live, or the
       * program offers no trial. `isSignedIn` tells the two apart.
       */
      readonly status: "subscription-required";
    }
  | {
      /** The account's subscription is bound to another installation. */
      readonly status: "device-mismatch";
      /** The installation it is bound to. */
      readonly boundDevice: BoundDevice;
    }
  | {
      /** No license is in force and none could be obtained; `reason` says why. */
      readonly status: "unavailable";
      /** Why: no network, the backend, the clock, an outdated program, a rejected license, the platform. */
      readonly reason: UnavailableReason;
    };

/** The part of the state every status carries. */
type SubscriptionContext = {
  /** Counts the changes. A snapshot with a lower number is older. */
  readonly revision: number;
  /** Whether a customer is signed in to the program (from `@handijit/auth`). */
  readonly isSignedIn: boolean;
  /** The last request for a license did not reach the backend. A held license keeps working until it expires. */
  readonly isOffline: boolean;
  /** A request for a license is on its way. */
  readonly isRefreshing: boolean;
  /** When the backend last answered a request for a license (epoch milliseconds). */
  readonly checkedAt: number | null;
  /** The limits of the license in force, by name; empty when none is in force or the plan has none. */
  readonly limits: Readonly<Record<string, number>>;
  /** The program's plans and their prices, for the paywall. */
  readonly plans: SubscriptionPlans;
  /** The purchase that is waiting in the browser; `null` when none is. */
  readonly purchase: PendingPurchase | null;
};

/** Everything the interface needs to know about the license. Plain data: survives IPC and JSON. */
type SubscriptionState = SubscriptionActivity & SubscriptionContext;

/** What `subscription:purchase` takes: the plan to buy. */
type PurchaseRequest = {
  /** The plan the customer picked. */
  readonly interval: PlanInterval;
};

type StateSchema = ZodType<SubscriptionState, SubscriptionState>;

/**
 * The IPC surface of the subscription as types. `subscriptionContract` in the `/main` entry is
 * the value; a program that spreads it into its own contract gets these channels typed on both
 * sides.
 */
type SubscriptionContract = {
  readonly invoke: {
    readonly "subscription:get-state": { readonly output: StateSchema };
    readonly "subscription:refresh": { readonly output: StateSchema };
    readonly "subscription:load-plans": { readonly output: StateSchema };
    readonly "subscription:purchase": {
      readonly input: ZodType<PurchaseRequest, PurchaseRequest>;
      readonly output: ZodType<boolean, boolean>;
    };
    readonly "subscription:cancel-purchase": { readonly output: StateSchema };
    readonly "subscription:manage": {
      readonly output: ZodType<boolean, boolean>;
    };
  };
  readonly events: {
    readonly "subscription:state-changed": StateSchema;
  };
};

/** A plain channel list: what `exposeBridge` of `@handijit/electron` accepts. */
type ChannelList = {
  /** Keys are the request–response channel names. */
  readonly invoke: Readonly<Record<string, unknown>>;
  /** Keys are the event channel names. */
  readonly events: Readonly<Record<string, unknown>>;
};

/** Removes the listener it was returned for. Safe to call more than once. */
type Unsubscribe = () => void;

export type {
  BoundDevice,
  ChannelList,
  PendingPurchase,
  PlanInterval,
  PlanOffer,
  PurchaseRequest,
  SubscriptionActivity,
  SubscriptionContext,
  SubscriptionContract,
  SubscriptionPlans,
  SubscriptionState,
  SubscriptionStatus,
  UnavailableReason,
  Unsubscribe,
};
