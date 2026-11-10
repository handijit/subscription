import { hostname } from "node:os";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import createSubscription from "../../lib/main/create-subscription";
import {
  DAY_MS,
  DEVICE_ID,
  FOREIGN_SIGNER,
  HOUR_MS,
  NEXT_SIGNER,
  OTHER_DEVICE_ID,
  PRODUCT,
  SIGNER,
  START,
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
} from "./subscription.fixture";

const { electron, secretStores } = vi.hoisted(() => ({
  electron: {} as ReturnType<typeof createElectronMock>,
  secretStores: [] as unknown[],
}));

vi.mock("electron", () => electron);
vi.mock("@handijit/electron/main", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSecretStore: () => {
    const store = createMemoryStore().store;
    secretStores.push(store);
    return store;
  },
}));

const recordWith = (
  license: string | null,
  extra: Readonly<Record<string, unknown>> = {}
): Record<string, string> => ({
  "subscription-license": JSON.stringify({
    version: 1,
    license,
    userId: null,
    trialEndedAt: null,
    latestSeenAt: START - HOUR_MS,
    ...extra,
  }),
});

beforeEach(() => {
  Object.assign(electron, createElectronMock());
  secretStores.length = 0;
  useClock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSubscription options", () => {
  test("should refuse a product that is not a slug", () => {
    const { auth } = createFakeAuth();
    for (const product of [
      "Notlar",
      "",
      "a".repeat(65),
      7 as unknown as string,
    ]) {
      expect(() =>
        createSubscription({ product, auth, appVersion: "1.0.0" })
      ).toThrow(/options\.product must be the product's slug/);
    }
  });

  test("should refuse a missing auth instance", () => {
    for (const auth of [undefined, null, {}]) {
      expect(() =>
        createSubscription({
          product: PRODUCT,
          auth: auth as never,
          appVersion: "1.0.0",
        })
      ).toThrow(/options\.auth must be the program's createAuth/);
    }
  });

  test("should refuse an app version that is not a version", () => {
    const { auth } = createFakeAuth();
    expect(() =>
      createSubscription({ product: PRODUCT, auth, appVersion: "latest" })
    ).toThrow(/options\.appVersion must be a version/);
  });

  test("should read the running version from Electron by default", async () => {
    const { subscription, fake } = setup({ appVersion: undefined });
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    expect(electron.app.getVersion).toHaveBeenCalled();
    expect(fake.issueLicense.mock.calls[0]?.[0]).toMatchObject({
      appVersion: "1.4.0",
    });
  });

  test("should refuse a device id the backend would reject", () => {
    const { auth } = createFakeAuth();
    expect(() =>
      createSubscription({
        product: PRODUCT,
        auth,
        appVersion: "1.0.0",
        deviceId: "short",
      })
    ).toThrow(/options\.deviceId must be 32-128 characters/);
  });

  test("should refuse an empty key list", () => {
    const { auth } = createFakeAuth();
    expect(() =>
      createSubscription({
        product: PRODUCT,
        auth,
        appVersion: "1.0.0",
        keys: [],
      })
    ).toThrow(/options\.keys must list at least one license key/);
  });

  test("should refuse a panel address that is not https", () => {
    const { auth } = createFakeAuth();
    for (const panelBaseUrl of [
      "http://www.handijit.com",
      "not a url",
      "https://user:secret@www.handijit.com",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        createSubscription({
          product: PRODUCT,
          auth,
          appVersion: "1.0.0",
          panelBaseUrl,
        })
      ).toThrow(/options\.panelBaseUrl must be an https URL/);
    }
  });

  test("should accept plain http towards this computer", async () => {
    const { subscription, openExternal } = setup({
      panelBaseUrl: "http://127.0.0.1:4000/ignored/path",
    });
    await subscription.manage();
    expect(openExternal).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/panel/hesabim/abonelik?product=notlar"
    );
  });

  test("should fall back to the defaults for durations out of range", async () => {
    const { subscription, fake } = setup({
      refreshIntervalMs: -5,
      purchaseTimeoutMs: Number.NaN,
    });
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * HOUR_MS - 1000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
  });

  test("should use the defaults of logger, store, device name and platform", async () => {
    const fake = createFakeAuth();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    const subscription = createSubscription({
      product: PRODUCT,
      auth: fake.auth,
      appVersion: "1.0.0",
      deviceId: DEVICE_ID,
    });
    const state = await startAndSettle(subscription);
    const os = { darwin: "macos", win32: "windows" }[
      process.platform as string
    ];
    const arch = ["x64", "arm64"].includes(process.arch)
      ? process.arch
      : undefined;
    if (os === undefined || arch === undefined) {
      expect(state).toMatchObject({
        status: "unavailable",
        reason: "unsupported-platform",
      });
      return;
    }
    expect(secretStores).toHaveLength(1);
    const body = fake.issueLicense.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    const expectedName = hostname()
      .replace(/\.local$/i, "")
      .trim()
      .slice(0, 100);
    expect(body).toMatchObject({ os, arch });
    expect(body.deviceName).toBe(
      expectedName === "" ? undefined : expectedName
    );
    expect(state).toMatchObject({ status: "trial-expired" });
    subscription.dispose();
  });

  test("should trust only the production keys by default", async () => {
    const { subscription, fake } = setup({ keys: undefined });
    fake.answers.trial = trialLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "update-required",
    });
  });

  test("should name the platform's device the same way when it resolves the device id", async () => {
    const memory = createMemoryStore({
      "subscription-device": "stored-device-id-0123456789abcdef01234567",
    });
    const fake = createFakeAuth();
    fake.answers.trial = offline();
    const subscription = createSubscription({
      product: PRODUCT,
      auth: fake.auth,
      appVersion: "1.0.0",
      secretStore: memory.store,
      arch: "x64",
    });
    await startAndSettle(subscription);
    expect(memory.store.get).toHaveBeenCalledWith("subscription-device");
    subscription.dispose();
  });
});

describe("createSubscription start", () => {
  test("should be loading and unpublished before start", () => {
    const { subscription, states } = setup();
    expect(subscription.getState()).toEqual({
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
    expect(Object.isFrozen(subscription.getState())).toBe(true);
    expect(states).toHaveLength(0);
  });

  test("should ask for a trial license and enter the trial", async () => {
    const { subscription, fake, memory } = setup();
    const issued = trialLicense({ trialDays: 7 });
    fake.answers.trial = issued;
    const state = await startAndSettle(subscription);

    expect(fake.issueLicense).toHaveBeenCalledWith({
      product: PRODUCT,
      deviceId: DEVICE_ID,
      deviceName: "Ofis-PC",
      os: "windows",
      arch: "x64",
      appVersion: "1.4.0",
    });
    expect(state).toMatchObject({
      status: "trial",
      trialEndsAt: START + 7 * DAY_MS,
      licenseExpiresAt: START + 72 * HOUR_MS,
      isSignedIn: false,
      isOffline: false,
      isRefreshing: false,
      checkedAt: START,
      limits: { records: 100 },
    });
    expect(memory.record()).toEqual({
      version: 1,
      license: issued.license,
      userId: null,
      trialEndedAt: null,
      latestSeenAt: START,
    });
  });

  test("should start once however often it is called", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    const first = subscription.start();
    expect(subscription.start()).toBe(first);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
  });

  test("should mark an unsupported platform and never ask", async () => {
    for (const platform of [
      { platform: "linux", arch: "x64" },
      { platform: "win32", arch: "ia32" },
    ]) {
      const { subscription, fake } = setup(platform);
      const state = await startAndSettle(subscription);
      expect(state).toMatchObject({
        status: "unavailable",
        reason: "unsupported-platform",
      });
      expect(await subscription.refresh()).toBe(subscription.getState());
      expect(fake.issueLicense).not.toHaveBeenCalled();
      expect(fake.auth.restore).not.toHaveBeenCalled();
    }
  });

  test("should drop the empty device name and cut a long one", async () => {
    const first = setup({ deviceName: "   " });
    first.fake.answers.trial = offline();
    await startAndSettle(first.subscription);
    expect(first.fake.issueLicense.mock.calls[0]?.[0]).not.toHaveProperty(
      "deviceName"
    );
    const second = setup({ deviceName: "x".repeat(150) });
    second.fake.answers.trial = offline();
    await startAndSettle(second.subscription);
    expect(
      (second.fake.issueLicense.mock.calls[0]?.[0] as { deviceName: string })
        .deviceName
    ).toHaveLength(100);
  });

  test("should use the stored license at once and keep it offline", async () => {
    const issued = trialLicense({ issuedAt: START - HOUR_MS });
    const memory = createMemoryStore(recordWith(issued.license));
    const { subscription, fake } = setup({}, { memory });
    fake.answers.trial = offline();

    const started = await subscription.start();
    expect(started).toMatchObject({
      status: "trial",
      limits: { records: 100 },
    });
    await settle();
    expect(subscription.getState()).toMatchObject({
      status: "trial",
      isOffline: true,
      checkedAt: null,
    });
    expect(subscription.isEntitled()).toBe(true);
  });

  test("should know offline that a stored trial is over", async () => {
    const issued = trialLicense({
      issuedAt: START - 8 * DAY_MS,
      trialDays: 7,
      expiresAt: START - DAY_MS,
    });
    const memory = createMemoryStore(recordWith(issued.license));
    const { subscription, fake } = setup({}, { memory });
    fake.answers.trial = offline();
    const state = await startAndSettle(subscription);
    expect(state).toMatchObject({
      status: "trial-expired",
      trialEndedAt: START - DAY_MS,
      isOffline: true,
    });
  });

  test("should not trust a stored license that lapsed before the trial ended", async () => {
    const issued = trialLicense({
      issuedAt: START - 4 * DAY_MS,
      trialDays: 7,
      expiresAt: START - DAY_MS,
    });
    const memory = createMemoryStore(recordWith(issued.license));
    const { subscription, fake } = setup({}, { memory });
    fake.answers.trial = offline();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "offline",
    });
    expect(subscription.isEntitled()).toBe(false);
  });

  test("should ignore a stored license of another key, device or product", async () => {
    for (const license of [
      trialLicense({ signer: FOREIGN_SIGNER }).license,
      trialLicense({ deviceId: OTHER_DEVICE_ID }).license,
      trialLicense({ product: "baska-program" }).license,
      "not-a-license",
    ]) {
      const memory = createMemoryStore(recordWith(license));
      const { subscription, fake } = setup({}, { memory });
      fake.answers.trial = offline();
      expect(await startAndSettle(subscription)).toMatchObject({
        status: "unavailable",
        reason: "offline",
      });
    }
  });

  test("should accept a stored license of every built-in key", async () => {
    const memory = createMemoryStore(
      recordWith(trialLicense({ signer: NEXT_SIGNER }).license)
    );
    const { subscription, fake } = setup({}, { memory });
    fake.answers.trial = offline();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
    });
  });

  test("should use a stored paid license only for its own customer", async () => {
    const issued = paidLicense({ plan: "yearly" });
    const record = recordWith(issued.license, { userId: 7 });

    const owner = createFakeAuth({ status: "signed-in", user: { id: 7 } });
    owner.answers.paid = offline();
    const mine = setup({}, { fake: owner, memory: createMemoryStore(record) });
    expect(await startAndSettle(mine.subscription)).toMatchObject({
      status: "subscribed",
      plan: "yearly",
      isSignedIn: true,
      isOffline: true,
    });

    const stranger = createFakeAuth({ status: "signed-in", user: { id: 8 } });
    stranger.answers.paid = offline();
    const theirs = setup(
      {},
      { fake: stranger, memory: createMemoryStore(record) }
    );
    expect(await startAndSettle(theirs.subscription)).toMatchObject({
      status: "unavailable",
      reason: "offline",
    });
  });

  test("should go on when the session cannot be restored", async () => {
    const { subscription, fake } = setup();
    fake.auth.restore.mockRejectedValueOnce(new Error("broken"));
    fake.answers.trial = trialLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
    });
  });

  test("should survive a session that cannot be read, and write nothing", async () => {
    const { subscription, fake, memory } = setup();
    fake.auth.getState.mockImplementation(() => {
      throw new Error("no session");
    });
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "service",
    });
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    subscription.isEntitled();
    await settle();
    expect(memory.store.set).not.toHaveBeenCalled();
  });

  test("should call an answer it cannot read a service failure", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = () =>
      Promise.resolve(
        Object.defineProperty({}, "license", {
          get: () => {
            throw new Error("broken answer");
          },
        }) as never
      );
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "service",
    });
  });

  test("should report a store that throws as a service failure", async () => {
    const { subscription, fake, logger } = setup({
      secretStore: {
        get: () => {
          throw new Error("disk on fire");
        },
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    });
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "service",
    });
    expect(fake.issueLicense).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: the stored license could not be read",
      { error: "Error: disk on fire" }
    );
  });

  test("should resolve the device id when none is given", async () => {
    const stored = "stored-device-id-0123456789abcdef01234567";
    const memory = createMemoryStore({ "subscription-device": stored });
    const { subscription, fake } = setup({ deviceId: undefined }, { memory });
    fake.answers.trial = offline();
    await startAndSettle(subscription);
    expect(fake.issueLicense.mock.calls[0]?.[0]).toMatchObject({
      deviceId: stored,
    });
  });

  test("should stop when disposed during start", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    const started = subscription.start();
    subscription.dispose();
    await started;
    await settle();
    expect(fake.issueLicense).not.toHaveBeenCalled();
    expect(electron.app.listenerCount("browser-window-focus")).toBe(0);
  });

  test("should not start after dispose", async () => {
    const { subscription, fake } = setup();
    subscription.dispose();
    subscription.dispose();
    await startAndSettle(subscription);
    expect(fake.auth.onChange).not.toHaveBeenCalled();
  });
});

describe("createSubscription trial refusals", () => {
  test("should show the end of the trial with its date", async () => {
    const { subscription, fake, memory } = setup();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED", {
      trialEndedAt: "2026-11-09T08:00:00Z",
    });
    const state = await startAndSettle(subscription);
    expect(state).toMatchObject({
      status: "trial-expired",
      trialEndedAt: Date.parse("2026-11-09T08:00:00Z"),
      checkedAt: START,
      limits: {},
    });
    expect(memory.record()).toMatchObject({
      license: null,
      trialEndedAt: Date.parse("2026-11-09T08:00:00Z"),
    });
    expect(subscription.isEntitled()).toBe(false);
  });

  test("should show the end of the trial without a date when none is given", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED", {
      trialEndedAt: "yesterday",
    });
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial-expired",
      trialEndedAt: null,
    });
  });

  test("should drop the held trial when the backend ends it", async () => {
    const { subscription, fake, memory } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    fake.answers.trial = problem(403, "TRIAL_EXPIRED", {
      trialEndedAt: new Date(START).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(5000);
    await subscription.refresh();
    expect(subscription.getState()).toMatchObject({ status: "trial-expired" });
    expect(memory.record()).toMatchObject({ license: null });
  });

  test("should require a subscription when the program has no trial", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(403, "TRIAL_NOT_AVAILABLE");
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "subscription-required",
      isSignedIn: false,
    });
  });

  test("should call a refusal it does not know a service failure", async () => {
    const { subscription, fake, logger } = setup();
    fake.answers.trial = problem(404, "NOT_FOUND");
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "service",
      isOffline: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: the license request failed",
      { kind: "problem", status: 404, code: "NOT_FOUND" }
    );
  });

  test("should call anything that is not an API error a service failure", async () => {
    const { subscription, fake, logger } = setup();
    fake.answers.trial = new TypeError("boom");
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "service",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: the license request failed",
      { kind: "internal" }
    );
  });

  test("should not log a problem's missing code", async () => {
    const { subscription, fake, logger } = setup();
    fake.answers.trial = problem(502);
    await startAndSettle(subscription);
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: the license request failed",
      { kind: "problem", status: 502 }
    );
  });

  test("should wait as long as a rate limit says", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(
      429,
      "TOO_MANY_REQUESTS",
      {},
      {
        retryAfterSeconds: 120,
      }
    );
    await startAndSettle(subscription);
    expect(subscription.getState()).toMatchObject({ reason: "service" });
    fake.answers.trial = trialLicense();
    await vi.advanceTimersByTimeAsync(60_000);
    await subscription.refresh();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
    expect(subscription.getState()).toMatchObject({ status: "trial" });
  });

  test("should wait ten minutes after a rate limit without Retry-After", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(429, "TOO_MANY_REQUESTS");
    await startAndSettle(subscription);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
  });

  test("should retry without the backend after 30 seconds, then longer", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = offline();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "offline",
      isOffline: true,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
    fake.answers.trial = trialLicense();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(3);
    expect(subscription.getState()).toMatchObject({
      status: "trial",
      isOffline: false,
    });
  });

  test("should cap the retry at fifteen minutes", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = offline();
    await startAndSettle(subscription);
    for (const delay of [30, 60, 120, 300, 900, 900]) {
      await vi.advanceTimersByTimeAsync(delay * 1000);
      await settle();
    }
    expect(fake.issueLicense).toHaveBeenCalledTimes(7);
  });
});

describe("createSubscription license verification", () => {
  test("should ask for an update when a fresh license names an unknown key", async () => {
    const { subscription, fake, logger } = setup();
    fake.answers.trial = trialLicense({ signer: FOREIGN_SIGNER });
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "update-required",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: the issued license was not accepted",
      expect.objectContaining({ reason: "update-required" })
    );
  });

  test("should reject a fresh license for another device", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense({ deviceId: OTHER_DEVICE_ID });
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "license-invalid",
    });
  });

  test("should reject a fresh license that is past its expiry while the clock is right", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = SIGNER.issue(
      {
        deviceId: DEVICE_ID,
        plan: "trial",
        issuedAt: START - 4 * DAY_MS,
        trialEndsAt: START + DAY_MS,
        expiresAt: START - DAY_MS,
      },
      START
    );
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "license-invalid",
    });
  });

  test("should blame the clock for a fresh license from the future", async () => {
    const { subscription, fake } = setup();
    const later = START + 2 * DAY_MS;
    fake.answers.trial = SIGNER.issue(
      {
        deviceId: DEVICE_ID,
        plan: "trial",
        issuedAt: later,
        trialEndsAt: later + 7 * DAY_MS,
        expiresAt: later + 3 * DAY_MS,
      },
      later
    );
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "clock",
    });
  });

  test("should keep a held license when a fresh one is rejected", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    fake.answers.trial = trialLicense({ deviceId: OTHER_DEVICE_ID });
    await vi.advanceTimersByTimeAsync(5000);
    await subscription.refresh();
    expect(subscription.getState()).toMatchObject({ status: "trial" });
  });

  test("should derive the trial end from the expiry when the claim is missing", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = SIGNER.issue({
      deviceId: DEVICE_ID,
      plan: "trial",
      issuedAt: START,
      expiresAt: START + DAY_MS,
    });
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
      trialEndsAt: START + DAY_MS,
    });
  });
});
