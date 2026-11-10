import type { ApiClient, LicenseKey } from "@handijit/core";

import type { PlanInterval, SubscriptionState, Unsubscribe } from "../types";

/** The part of a logger the subscription writes to. `@handijit/electron`'s logger fits. */
type SubscriptionLogger = {
  /** Something worth knowing happened: a license was issued, refused or dropped. */
  readonly info: (
    message: string,
    context?: Readonly<Record<string, unknown>>
  ) => void;
  /** Something went wrong that the program survives: the backend, the store, the clock. */
  readonly warn: (
    message: string,
    context?: Readonly<Record<string, unknown>>
  ) => void;
};

/** The part of `@handijit/auth`'s session state the subscription reads. */
type SubscriptionAuthState = {
  /** `signed-in` when a customer session is held; anything else counts as signed out. */
  readonly status: string;
  /** The signed-in customer; only the id is read, to keep a paid license to its owner. */
  readonly user: { readonly id: number } | null;
};

/**
 * The part of `@handijit/auth`'s `Auth` the subscription uses. `createAuth(...)` fits as it is;
 * a test passes a fake. The subscription never signs in or out itself.
 */
type SubscriptionAuth = {
  /** The API client; it sends the customer's access token on requests with `auth: true`. */
  readonly client: Pick<ApiClient, "request" | "issueLicense">;
  /** The session state now. */
  readonly getState: () => SubscriptionAuthState;
  /** Listens to session changes: a sign-in or sign-out refreshes the license. */
  readonly onChange: (
    listener: (state: SubscriptionAuthState) => void
  ) => Unsubscribe;
  /** Reads the stored session; awaited once before the first license request. */
  readonly restore: () => Promise<unknown>;
};

/** Where the subscription keeps its license and its device id. `@handijit/electron`'s secret store fits. */
type SubscriptionSecretStore = {
  /** Reads a secret; `null` when there is none or it cannot be read. */
  readonly get: (name: string) => Promise<string | null>;
  /** Writes a secret; rejects when the machine cannot encrypt it. */
  readonly set: (name: string, value: string) => Promise<void>;
  /** Removes a secret. */
  readonly delete: (name: string) => Promise<void>;
};

/** How `createSubscription` is set up. */
type SubscriptionOptions = {
  /** The product's slug, as the backend knows it: `"on-muhasebe"`. */
  product: string;
  /** The program's `@handijit/auth` instance (one per process). */
  auth: SubscriptionAuth;
  /** Where log lines go; the subscription never writes a license, token or device id. Default: nowhere. */
  logger?: SubscriptionLogger;
  /** Where the last valid license and the device id are kept. Default: `createSecretStore()` of `@handijit/electron`. */
  secretStore?: SubscriptionSecretStore;
  /**
   * The keys licenses are verified against: the trust root. Default: `PRODUCTION_LICENSE_KEYS`
   * of `@handijit/core`. Never pass a list fetched from the network; a test or a staging
   * backend passes its own.
   */
  keys?: readonly LicenseKey[];
  /** The web site the subscription page is on. Default: `https://www.handijit.com`. */
  panelBaseUrl?: string;
  /** Opens a page in the system browser and resolves with whether it did. Default: `shell.openExternal`. */
  openExternal?: (url: string) => Promise<boolean>;
  /** The running version, sent with every license request. Default: `app.getVersion()`. */
  appVersion?: string;
  /**
   * The installation's device id (32-128 characters of `A-Z a-z 0-9 _ -`). Default: derived
   * from the machine's own id and the product, so that a reinstall keeps it, and stored.
   */
  deviceId?: string;
  /** The name the customer knows this machine by, shown in the panel. Default: the host name. */
  deviceName?: string;
  /** How often the license is renewed while the program runs, in milliseconds (at least 1 minute). Default: 6 hours. */
  refreshIntervalMs?: number;
  /** How long a purchase in the browser is waited for, in milliseconds (at least 1 minute). Default: 30 minutes. */
  purchaseTimeoutMs?: number;
  /** For tests: stands in for `process.platform`. */
  platform?: string;
  /** For tests: stands in for `process.arch`. */
  arch?: string;
  /** For tests: the clock. Default: `Date.now`. */
  now?: () => number;
  /** For tests: the source of the retry jitter. Default: `Math.random`. */
  random?: () => number;
};

/** The answer of `check`: whether something may be done, and if not, why. */
type AccessCheck =
  | { readonly isAllowed: true }
  | {
      readonly isAllowed: false;
      /** `not-entitled`: no license is in force; `limit-reached`: the plan's limit is used up. */
      readonly reason: "not-entitled" | "limit-reached";
      /** The limit that was asked about; `null` when none was. */
      readonly limit: string | null;
      /** The plan's value of that limit; `null` when not entitled at all. */
      readonly max: number | null;
    };

/** The subscription of a program: one per main process. */
type Subscription = {
  /** The current state. The object is frozen; every change produces a new one. */
  readonly getState: () => SubscriptionState;
  /** Listens to state changes. Returns the function that stops listening. */
  readonly onChange: (
    listener: (state: SubscriptionState) => void
  ) => Unsubscribe;
  /**
   * Restores the session and the stored license, decides with what it has and renews the
   * license in the background. Resolves once the stored license is applied; calling it again
   * starts nothing. Never rejects.
   */
  readonly start: () => Promise<SubscriptionState>;
  /** Asks the backend for a license now. Resolves when it answered or failed; never rejects. */
  readonly refresh: () => Promise<SubscriptionState>;
  /** Whether a verified license is in force right now. */
  readonly isEntitled: () => boolean;
  /**
   * Whether a license is in force and, with a limit name, whether `used` is still below it. A
   * limit the license does not name is unlimited; a limit of 0 switches the feature off.
   */
  readonly check: (limit?: string, used?: number) => AccessCheck;
  /** Like `check`, but throws a `SubscriptionAccessError` when it is not allowed. For main-side enforcement. */
  readonly require: (limit?: string, used?: number) => void;
  /** Reads the plans and their prices for display. Never rejects; a failure is `plans.status: "failed"`. */
  readonly loadPlans: () => Promise<SubscriptionState>;
  /**
   * Opens the subscription page for a plan in the browser and waits for the purchase: the
   * license is asked for again and again until a paid one arrives or `purchaseTimeoutMs`
   * passes. Resolves with whether the page opened.
   */
  readonly purchase: (interval: PlanInterval) => Promise<boolean>;
  /** Stops waiting for a purchase. */
  readonly cancelPurchase: () => SubscriptionState;
  /** Opens the subscription page (manage, cancel, free the device). Resolves with whether it opened. */
  readonly manage: () => Promise<boolean>;
  /** Stops the timers and the listeners. The subscription stays readable and inert. */
  readonly dispose: () => void;
};

export type {
  AccessCheck,
  Subscription,
  SubscriptionAuth,
  SubscriptionAuthState,
  SubscriptionLogger,
  SubscriptionOptions,
  SubscriptionSecretStore,
};
