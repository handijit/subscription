import { EventEmitter } from "node:events";

import { deserializeApiError } from "@handijit/core/errors";
import { vi } from "vitest";

import createSubscription from "../../lib/main/create-subscription";
import type {
  Subscription,
  SubscriptionAuthState,
  SubscriptionOptions,
  SubscriptionSecretStore,
} from "../../lib/main/types";
import type { SubscriptionState } from "../../lib/types";
import createLicenseSigner from "../support/license-signer";
import PENDING_CRYPTO from "../support/pending-crypto";
import type {
  IssuedLicense,
  LicenseInput,
  LicenseSigner,
} from "../support/license-signer";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Tuesday 10 November 2026, 08:00 UTC: where every test's clock starts. */
const START = Date.UTC(2026, 10, 10, 8);
const PRODUCT = "notlar";
const DEVICE_ID = "device-0123456789abcdef0123456789abcdef";
const OTHER_DEVICE_ID = "device-ffffffffffffffffffffffffffffffff";
const TTL_MS = 72 * HOUR_MS;

/** The key the backend signs with in the tests, and the next one of a rotation. */
const SIGNER = createLicenseSigner("test-2026-01", PRODUCT);
const NEXT_SIGNER = createLicenseSigner("test-2026-02", PRODUCT);
const FOREIGN_SIGNER = createLicenseSigner("someone-else", PRODUCT);

type LicenseOptions = Partial<LicenseInput> & {
  /** Who signs it. Default: the backend's current key. */
  readonly signer?: LicenseSigner;
  /** How long the trial lasts from the issue, in days. Default: 7. */
  readonly trialDays?: number;
};

/** A trial license issued now, ending in `trialDays`. */
const trialLicense = ({
  signer = SIGNER,
  trialDays = 7,
  ...input
}: LicenseOptions = {}): IssuedLicense => {
  const issuedAt = input.issuedAt ?? Date.now();
  const trialEndsAt = input.trialEndsAt ?? issuedAt + trialDays * DAY_MS;
  return signer.issue({
    deviceId: DEVICE_ID,
    limits: { records: 100 },
    ...input,
    plan: "trial",
    issuedAt,
    trialEndsAt,
    expiresAt: input.expiresAt ?? Math.min(issuedAt + TTL_MS, trialEndsAt),
  });
};

/** A paid license issued now. */
const paidLicense = ({
  signer = SIGNER,
  ...input
}: Omit<LicenseOptions, "trialDays"> = {}): IssuedLicense => {
  const issuedAt = input.issuedAt ?? Date.now();
  return signer.issue({
    deviceId: DEVICE_ID,
    plan: "monthly",
    ...input,
    issuedAt,
    expiresAt: input.expiresAt ?? issuedAt + TTL_MS,
  });
};

/** A refusal of the backend, as the API client of `@handijit/core` throws it. */
const problem = (
  status: number,
  code?: string,
  extensions: Readonly<Record<string, unknown>> = {},
  extra: Readonly<Record<string, unknown>> = {}
): Error =>
  deserializeApiError({
    name: "HandijitApiError",
    kind: "problem",
    message: `the backend answered ${status}`,
    method: "POST",
    path: "/api/public/licenses",
    status,
    ...(code === undefined ? {} : { code }),
    fields: [],
    extensions,
    ...extra,
  });

/** No answer at all. */
const offline = (): Error =>
  deserializeApiError({
    name: "HandijitApiError",
    kind: "network",
    message: "fetch failed",
    method: "POST",
    path: "/api/public/licenses",
  });

type Answer = IssuedLicense | Error | (() => Promise<IssuedLicense>);

const answer = async (value: Answer | undefined): Promise<IssuedLicense> => {
  if (value === undefined) throw offline();
  if (typeof value === "function") return value();
  if (value instanceof Error) throw value;
  return value;
};

/**
 * The part of `createAuth(...)` the subscription uses, scripted: the trial and paid endpoints
 * answer with what the test set, the session changes when the test says so.
 */
const createFakeAuth = (
  initial: SubscriptionAuthState = { status: "signed-out", user: null }
) => {
  let session = initial;
  const listeners = new Set<(state: SubscriptionAuthState) => void>();
  const answers: { trial?: Answer; paid?: Answer; plans?: unknown } = {};
  const issueLicense = vi.fn<(body: unknown) => Promise<IssuedLicense>>(() =>
    answer(answers.trial)
  );
  const issuePaidLicense = vi.fn<(body: unknown) => Promise<IssuedLicense>>(
    () => answer(answers.paid)
  );
  const getPlans = vi.fn(async () => {
    if (answers.plans instanceof Error) throw answers.plans;
    return answers.plans ?? [];
  });
  // Nothing of the subscription goes through the generic request any more.
  const request = vi.fn(async (spec: { path: string }) => {
    throw new Error(`unexpected request to ${spec.path}`);
  });
  const auth = {
    client: {
      issueLicense,
      issuePaidLicense,
      getPlans,
      request,
    } as unknown as SubscriptionOptions["auth"]["client"],
    getState: vi.fn(() => session),
    onChange: vi.fn((listener: (state: SubscriptionAuthState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    restore: vi.fn(() => Promise.resolve(session)),
  };
  return {
    auth,
    issueLicense,
    issuePaidLicense,
    getPlans,
    request,
    answers,
    paidCalls: (): number => issuePaidLicense.mock.calls.length,
    plansCalls: (): number => getPlans.mock.calls.length,
    signIn: (id = 7): void => {
      session = { status: "signed-in", user: { id } };
      for (const listener of [...listeners]) listener(session);
    },
    signOut: (): void => {
      session = { status: "signed-out", user: null };
      for (const listener of [...listeners]) listener(session);
    },
    emit: (state: SubscriptionAuthState): void => {
      session = state;
      for (const listener of [...listeners]) listener(state);
    },
    listenerCount: (): number => listeners.size,
  };
};

/** The secret store in memory; `failWrites` plays a machine without encryption. */
const createMemoryStore = (entries: Record<string, string> = {}) => {
  const data = new Map(Object.entries(entries));
  let shouldFail = false;
  const store: SubscriptionSecretStore & { data: Map<string, string> } = {
    data,
    get: vi.fn((name: string) => Promise.resolve(data.get(name) ?? null)),
    set: vi.fn((name: string, value: string) => {
      if (shouldFail) return Promise.reject(new Error("no encryption"));
      data.set(name, value);
      return Promise.resolve();
    }),
    delete: vi.fn((name: string) => {
      data.delete(name);
      return Promise.resolve();
    }),
  };
  return {
    store,
    failWrites: (value = true): void => {
      shouldFail = value;
    },
    record: (): Record<string, unknown> | null => {
      const text = data.get("subscription-license");
      return text === undefined
        ? null
        : (JSON.parse(text) as Record<string, unknown>);
    },
  };
};

/** Electron's `app`, `powerMonitor` and `shell` as the tests' mock of `electron` exposes them. */
const createElectronMock = () => {
  const app = Object.assign(new EventEmitter(), {
    getVersion: vi.fn(() => "1.4.0"),
    whenReady: vi.fn(() => Promise.resolve()),
  });
  const powerMonitor = new EventEmitter();
  const shell = {
    openExternal: vi.fn<(url: string) => Promise<void>>(() =>
      Promise.resolve()
    ),
  };
  return { app, powerMonitor, shell };
};

const QUIET_TURNS = 30;
const SETTLE_LIMIT_MS = 5000;

/**
 * Lets real promises (WebCrypto, the store) settle while the timers stay fake: turns the event
 * loop until no license verification has been running for 30 turns in a row. WebCrypto runs
 * on Node's thread pool, so a fixed number of turns is enough on one machine and too few on a
 * busy one (it was on CI's Linux).
 */
const settle = async (): Promise<void> => {
  const deadline = performance.now() + SETTLE_LIMIT_MS;
  let quietTurns = 0;
  while (quietTurns < QUIET_TURNS) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    quietTurns = PENDING_CRYPTO.count === 0 ? quietTurns + 1 : 0;
    if (performance.now() > deadline) {
      throw new Error(
        `settle: ${PENDING_CRYPTO.count} license verification(s) still running after ${SETTLE_LIMIT_MS} ms`
      );
    }
  }
};

type Setup = {
  readonly subscription: Subscription;
  readonly fake: ReturnType<typeof createFakeAuth>;
  readonly memory: ReturnType<typeof createMemoryStore>;
  readonly states: SubscriptionState[];
  readonly logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  readonly openExternal: ReturnType<typeof vi.fn>;
};

/** A subscription over the fakes, with the clock at START unless the test moved it. */
const setup = (
  overrides: Partial<SubscriptionOptions> = {},
  {
    fake = createFakeAuth(),
    memory = createMemoryStore(),
  }: {
    fake?: ReturnType<typeof createFakeAuth>;
    memory?: ReturnType<typeof createMemoryStore>;
  } = {}
): Setup => {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const openExternal = vi.fn<(url: string) => Promise<boolean>>(() =>
    Promise.resolve(true)
  );
  const subscription = createSubscription({
    product: PRODUCT,
    auth: fake.auth,
    secretStore: memory.store,
    logger,
    keys: [SIGNER.key, NEXT_SIGNER.key],
    deviceId: DEVICE_ID,
    deviceName: "Ofis-PC",
    appVersion: "1.4.0",
    platform: "win32",
    arch: "x64",
    openExternal,
    random: () => 0.5,
    ...overrides,
  });
  const states: SubscriptionState[] = [];
  subscription.onChange((state) => {
    states.push(state);
  });
  return { subscription, fake, memory, states, logger, openExternal };
};

/** Starts and waits until the first answer of the backend is applied. */
const startAndSettle = async (
  subscription: Subscription
): Promise<SubscriptionState> => {
  await subscription.start();
  await settle();
  return subscription.getState();
};

/** Fake timers that leave `setImmediate` real, so that `settle` works. */
const useClock = (now = START): void => {
  vi.useFakeTimers({
    now,
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
};

export {
  DAY_MS,
  DEVICE_ID,
  FOREIGN_SIGNER,
  HOUR_MS,
  MINUTE_MS,
  NEXT_SIGNER,
  OTHER_DEVICE_ID,
  PRODUCT,
  SECOND_MS,
  SIGNER,
  START,
  TTL_MS,
  createElectronMock,
  createFakeAuth,
  createMemoryStore,
  offline,
  paidLicense,
  problem,
  settle,
  setup,
  startAndSettle,
  trialLicense,
  useClock,
};
