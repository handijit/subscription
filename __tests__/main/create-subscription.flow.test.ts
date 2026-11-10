import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import SubscriptionAccessError from "../../lib/main/subscription-access-error";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  PAID_PATH,
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

const { electron } = vi.hoisted(() => ({
  electron: {} as ReturnType<typeof createElectronMock>,
}));

vi.mock("electron", () => electron);

const signedIn = (id = 7) =>
  createFakeAuth({ status: "signed-in", user: { id } });

beforeEach(() => {
  Object.assign(electron, createElectronMock());
  useClock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSubscription paid license", () => {
  test("should ask for the paid license while signed in", async () => {
    const fake = signedIn();
    const { subscription, memory } = setup({}, { fake });
    const issued = paidLicense({ plan: "yearly", limits: { users: 3 } });
    fake.answers.paid = issued;
    const state = await startAndSettle(subscription);

    expect(fake.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: PAID_PATH,
        auth: true,
        body: expect.objectContaining({ product: "notlar" }),
      })
    );
    expect(fake.issueLicense).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: "subscribed",
      plan: "yearly",
      isSignedIn: true,
      limits: { users: 3 },
      licenseExpiresAt: START + 72 * HOUR_MS,
    });
    expect(memory.record()).toMatchObject({
      license: issued.license,
      userId: 7,
    });
  });

  test("should fall back to the running trial without a subscription", async () => {
    const fake = signedIn();
    const { subscription, memory } = setup({}, { fake });
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = trialLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
      isSignedIn: true,
    });
    expect(memory.record()).toMatchObject({ userId: null });
  });

  test("should require a subscription once the trial is over too", async () => {
    const fake = signedIn();
    const { subscription, memory } = setup({}, { fake });
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED", {
      trialEndedAt: "2026-11-01T00:00:00Z",
    });
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "subscription-required",
      isSignedIn: true,
    });
    expect(memory.record()).toMatchObject({
      trialEndedAt: Date.parse("2026-11-01T00:00:00Z"),
    });
  });

  test("should name the device a subscription is bound to", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = problem(409, "SUBSCRIPTION_DEVICE_MISMATCH", {
      boundDevice: { name: "Muhasebe-PC", os: "windows" },
    });
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "device-mismatch",
      boundDevice: { name: "Muhasebe-PC", os: "windows" },
    });
  });

  test("should leave out what the backend did not say about the device", async () => {
    for (const extensions of [
      {},
      { boundDevice: null },
      { boundDevice: { name: "", os: 7 } },
    ]) {
      const fake = signedIn();
      const { subscription } = setup({}, { fake });
      fake.answers.paid = problem(
        409,
        "SUBSCRIPTION_DEVICE_MISMATCH",
        extensions
      );
      fake.answers.trial = offline();
      expect(await startAndSettle(subscription)).toMatchObject({
        status: "device-mismatch",
        boundDevice: { name: null, os: null },
      });
    }
  });

  test("should treat a refused session like a signed-out user", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = problem(401, "INVALID_TOKEN");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial-expired",
    });
  });

  test("should require a subscription when a refused session has no trial either", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = problem(401);
    fake.answers.trial = problem(403, "TRIAL_NOT_AVAILABLE");
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "subscription-required",
    });
  });

  test("should keep the held subscription without the backend", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = paidLicense();
    await startAndSettle(subscription);
    fake.answers.paid = offline();
    await vi.advanceTimersByTimeAsync(5000);
    await subscription.refresh();
    expect(subscription.getState()).toMatchObject({
      status: "subscribed",
      isOffline: true,
    });
    expect(fake.issueLicense).not.toHaveBeenCalled();
  });

  test("should drop a cancelled subscription", async () => {
    const fake = signedIn();
    const { subscription, memory } = setup({}, { fake });
    fake.answers.paid = paidLicense();
    await startAndSettle(subscription);
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = offline();
    await vi.advanceTimersByTimeAsync(5000);
    await subscription.refresh();
    expect(subscription.getState()).toMatchObject({
      status: "subscription-required",
    });
    expect(memory.record()).toMatchObject({ license: null });
  });
});

describe("createSubscription session changes", () => {
  test("should ask for the paid license right after a sign-in", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    expect(subscription.getState().status).toBe("trial-expired");

    fake.answers.paid = paidLicense();
    fake.signIn(7);
    expect(subscription.getState()).toMatchObject({ isSignedIn: true });
    await settle();
    expect(subscription.getState()).toMatchObject({ status: "subscribed" });
  });

  test("should drop the paid license on sign-out and ask for the trial", async () => {
    const fake = signedIn();
    const { subscription, memory } = setup({}, { fake });
    fake.answers.paid = paidLicense();
    await startAndSettle(subscription);
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    fake.signOut();
    await settle();
    expect(memory.record()).toMatchObject({ license: null });
    expect(subscription.getState()).toMatchObject({
      status: "trial-expired",
      isSignedIn: false,
    });
  });

  test("should keep a trial across sign-in and sign-out", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.signIn(7);
    await settle();
    expect(subscription.getState()).toMatchObject({ status: "trial" });
    fake.signOut();
    await settle();
    expect(subscription.getState()).toMatchObject({ status: "trial" });
  });

  test("should forget a refusal that belonged to the customer", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = problem(409, "SUBSCRIPTION_DEVICE_MISMATCH");
    fake.answers.trial = problem(403, "TRIAL_NOT_AVAILABLE");
    await startAndSettle(subscription);
    fake.answers.trial = offline();
    fake.signOut();
    expect(subscription.getState()).toMatchObject({ status: "loading" });
    await settle();
    expect(subscription.getState()).toMatchObject({
      status: "unavailable",
      reason: "offline",
    });
  });

  test("should drop a paid license when another customer signs in", async () => {
    const fake = signedIn(7);
    const { subscription } = setup({}, { fake });
    fake.answers.paid = paidLicense();
    await startAndSettle(subscription);
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    fake.signIn(8);
    await settle();
    expect(subscription.getState()).toMatchObject({
      status: "subscription-required",
    });
  });

  test("should ignore the session while it is in between", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    const before = subscription.getState();
    fake.emit({ status: "signing-in", user: null });
    fake.emit({ status: "signed-in", user: null });
    fake.emit({ status: "signed-out", user: null });
    await settle();
    expect(subscription.getState()).toBe(before);
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
  });

  test("should drop an answer that arrived for the previous session", async () => {
    const { subscription, fake } = setup();
    let release: () => void = () => undefined;
    fake.answers.trial = () =>
      new Promise((resolve) => {
        release = () => {
          resolve(trialLicense());
        };
      });
    await subscription.start();
    await settle();
    fake.answers.paid = paidLicense();
    fake.signIn(7);
    release();
    await settle();
    expect(subscription.getState()).toMatchObject({ status: "subscribed" });
    expect(fake.paidCalls()).toBe(1);
  });

  test("should follow the session restored during start without asking twice", async () => {
    const { subscription, fake } = setup();
    fake.auth.restore.mockImplementation(() => {
      fake.signIn(7);
      return Promise.resolve(fake.auth.getState());
    });
    fake.answers.paid = paidLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "subscribed",
    });
    expect(fake.paidCalls()).toBe(1);
  });

  test("should follow a sign-in that happens before start", async () => {
    const { subscription, fake } = setup();
    fake.signIn(7);
    fake.answers.paid = paidLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "subscribed",
    });
    expect(fake.paidCalls()).toBe(1);
  });
});

describe("createSubscription purchase", () => {
  test("should open the plan's page and wait for the paid license", async () => {
    const fake = signedIn();
    const { subscription, openExternal } = setup({}, { fake });
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);

    expect(await subscription.purchase("yearly")).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(
      "https://www.handijit.com/panel/hesabim/abonelik?product=notlar&interval=yearly"
    );
    expect(subscription.getState()).toMatchObject({
      status: "trial",
      purchase: {
        interval: "yearly",
        startedAt: START,
        expiresAt: START + 30 * MINUTE_MS,
      },
    });

    // Refusals while waiting change nothing and do not ask for the trial again.
    const paidBefore = fake.paidCalls();
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(fake.paidCalls()).toBe(paidBefore + 1);
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    expect(subscription.getState()).toMatchObject({ status: "trial" });

    fake.answers.paid = paidLicense({ plan: "yearly" });
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(subscription.getState()).toMatchObject({
      status: "subscribed",
      plan: "yearly",
      purchase: null,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(fake.paidCalls()).toBe(paidBefore + 2);
  });

  test("should poll at 5, 10, 15, 20 and then every 30 seconds", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    await subscription.purchase("monthly");
    const base = fake.paidCalls();
    for (const [delay, count] of [
      [5, 1],
      [10, 2],
      [15, 3],
      [20, 4],
      [30, 5],
      [30, 6],
    ] as const) {
      await vi.advanceTimersByTimeAsync(delay * 1000 - 1);
      await settle();
      expect(fake.paidCalls()).toBe(base + count - 1);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(fake.paidCalls()).toBe(base + count);
    }
  });

  test("should stop waiting after the time limit", async () => {
    const fake = signedIn();
    const { subscription, logger } = setup(
      { purchaseTimeoutMs: 2 * MINUTE_MS },
      { fake }
    );
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    await subscription.purchase("monthly");
    await vi.advanceTimersByTimeAsync(2 * MINUTE_MS + 1000);
    await settle();
    expect(subscription.getState().purchase).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      "subscription: stopped waiting for the purchase"
    );
  });

  test("should not ask while nobody is signed in, and ask at sign-in", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    await subscription.purchase("monthly");
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(fake.paidCalls()).toBe(0);
    fake.answers.paid = paidLicense();
    fake.signIn(7);
    await settle();
    expect(subscription.getState()).toMatchObject({
      status: "subscribed",
      purchase: null,
    });
  });

  test("should ask at once when the window gets the focus back", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    await subscription.purchase("monthly");
    const base = fake.paidCalls();
    fake.answers.paid = paidLicense();
    electron.app.emit("browser-window-focus");
    await settle();
    expect(fake.paidCalls()).toBe(base + 1);
    expect(subscription.getState()).toMatchObject({ status: "subscribed" });
  });

  test("should stop waiting when cancelled", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = problem(403, "SUBSCRIPTION_REQUIRED");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    await subscription.purchase("monthly");
    const base = fake.paidCalls();
    expect(subscription.cancelPurchase().purchase).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(fake.paidCalls()).toBe(base);
  });

  test("should not wait when the page did not open", async () => {
    const { subscription, openExternal } = setup();
    openExternal.mockResolvedValueOnce(false);
    expect(await subscription.purchase("monthly")).toBe(false);
    openExternal.mockRejectedValueOnce(new Error("no browser"));
    expect(await subscription.purchase("monthly")).toBe(false);
    expect(subscription.getState().purchase).toBeNull();
  });

  test("should not wait when already subscribed", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = paidLicense();
    await startAndSettle(subscription);
    expect(await subscription.purchase("yearly")).toBe(true);
    expect(subscription.getState().purchase).toBeNull();
  });

  test("should not wait after dispose", async () => {
    const { subscription } = setup();
    subscription.dispose();
    expect(await subscription.purchase("monthly")).toBe(true);
    expect(subscription.getState().purchase).toBeNull();
  });

  test("should refuse a plan that does not exist", async () => {
    const { subscription } = setup();
    await expect(subscription.purchase("weekly" as never)).rejects.toThrow(
      /interval must be "monthly" or "yearly"/
    );
  });

  test("should open the subscription page to manage it", async () => {
    const { subscription, openExternal } = setup();
    expect(await subscription.manage()).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(
      "https://www.handijit.com/panel/hesabim/abonelik?product=notlar"
    );
  });

  test("should open pages with the system browser by default", async () => {
    const { subscription } = setup({ openExternal: undefined });
    expect(await subscription.manage()).toBe(true);
    expect(electron.shell.openExternal).toHaveBeenCalledWith(
      "https://www.handijit.com/panel/hesabim/abonelik?product=notlar"
    );
    electron.shell.openExternal.mockRejectedValueOnce(new Error("refused"));
    expect(await subscription.manage()).toBe(false);
  });
});

describe("createSubscription plans", () => {
  const PLANS = [
    {
      interval: "yearly",
      priceKurus: 149_000,
      currency: "TRY",
      available: true,
    },
    { interval: "weekly", priceKurus: 100, currency: "TRY", available: true },
    {
      interval: "monthly",
      priceKurus: 14_900,
      currency: "TRY",
      available: false,
    },
  ];

  test("should read the plans as soon as the paywall may show them", async () => {
    const { subscription, fake } = setup();
    fake.answers.plans = PLANS;
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    expect(subscription.getState().plans).toEqual({
      status: "ready",
      offers: [
        {
          interval: "monthly",
          priceKurus: 14_900,
          currency: "TRY",
          isAvailable: false,
        },
        {
          interval: "yearly",
          priceKurus: 149_000,
          currency: "TRY",
          isAvailable: true,
        },
      ],
    });
  });

  test("should not read the plans for a subscriber", async () => {
    const fake = signedIn();
    const { subscription } = setup({}, { fake });
    fake.answers.paid = paidLicense();
    await startAndSettle(subscription);
    expect(fake.plansCalls()).toBe(0);
    expect(subscription.getState().plans.status).toBe("idle");
  });

  test("should show no plans for a program that is not on sale", async () => {
    const { subscription, fake } = setup();
    fake.answers.plans = problem(404, "NOT_FOUND");
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    expect(subscription.getState().plans).toEqual({
      status: "ready",
      offers: [],
    });
  });

  test("should report plans that could not be read and read them again on demand", async () => {
    const { subscription, fake, logger } = setup();
    fake.answers.plans = offline();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    expect(subscription.getState().plans).toEqual({
      status: "failed",
      offers: [],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: the plans could not be read",
      { kind: "network" }
    );
    fake.answers.plans = PLANS;
    const first = subscription.loadPlans();
    expect(subscription.loadPlans()).toBe(first);
    expect(subscription.getState().plans.status).toBe("loading");
    await first;
    expect(subscription.getState().plans.status).toBe("ready");
  });

  test("should keep ready plans for an hour", async () => {
    const { subscription, fake } = setup();
    fake.answers.plans = PLANS;
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    await subscription.loadPlans();
    expect(fake.plansCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    await subscription.loadPlans();
    expect(fake.plansCalls()).toBe(2);
  });

  test("should not read plans after dispose", async () => {
    const { subscription, fake } = setup();
    subscription.dispose();
    await subscription.loadPlans();
    expect(fake.plansCalls()).toBe(0);
  });
});

describe("createSubscription focus and resume", () => {
  test("should ask again on focus after 30 seconds while blocked", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    electron.app.emit("browser-window-focus");
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    electron.app.emit("browser-window-focus");
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
  });

  test("should ask again on focus only after 15 minutes while licensed", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    await vi.advanceTimersByTimeAsync(14 * MINUTE_MS);
    electron.app.emit("browser-window-focus");
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    electron.app.emit("browser-window-focus");
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
  });

  test("should ask again after the computer wakes up", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    electron.powerMonitor.emit("resume");
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    electron.powerMonitor.emit("resume");
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
  });

  test("should fold quick refreshes into one request", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    await subscription.refresh();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    const first = subscription.refresh();
    expect(subscription.refresh()).toBe(first);
    await first;
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
  });

  test("should stop listening when disposed", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    expect(electron.app.listenerCount("browser-window-focus")).toBe(1);
    expect(electron.powerMonitor.listenerCount("resume")).toBe(1);
    subscription.dispose();
    expect(electron.app.listenerCount("browser-window-focus")).toBe(0);
    expect(electron.powerMonitor.listenerCount("resume")).toBe(0);
    expect(fake.listenerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(7 * DAY_MS);
    await subscription.refresh();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
  });

  test("should not listen when disposed before Electron is ready", async () => {
    let ready: () => void = () => undefined;
    electron.app.whenReady.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        ready = resolve;
      })
    );
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    subscription.dispose();
    ready();
    await settle();
    expect(electron.app.listenerCount("browser-window-focus")).toBe(0);
  });

  test("should survive Electron refusing to report readiness", async () => {
    electron.app.whenReady.mockImplementationOnce(() =>
      Promise.reject(new Error("no"))
    );
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
    });
  });

  test("should drop an answer that arrives after dispose", async () => {
    const { subscription, fake } = setup();
    let release: () => void = () => undefined;
    fake.answers.trial = () =>
      new Promise((resolve) => {
        release = () => {
          resolve(trialLicense());
        };
      });
    await subscription.start();
    await settle();
    subscription.dispose();
    release();
    await settle();
    expect(subscription.getState().status).not.toBe("trial");
    expect(subscription.isEntitled()).toBe(false);
  });
});

describe("createSubscription access", () => {
  test("should refuse everything without a license", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = problem(403, "TRIAL_EXPIRED");
    await startAndSettle(subscription);
    expect(subscription.check()).toEqual({
      isAllowed: false,
      reason: "not-entitled",
      limit: null,
      max: null,
    });
    expect(subscription.check("records")).toMatchObject({ limit: "records" });
    expect(() => {
      subscription.require();
    }).toThrow(SubscriptionAccessError);
    try {
      subscription.require("records");
    } catch (error) {
      expect(error).toMatchObject({
        name: "SubscriptionAccessError",
        code: "NOT_ENTITLED",
        limit: "records",
        max: null,
      });
    }
  });

  test("should measure use against the plan's limits", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense({ limits: { records: 100, export: 0 } });
    await startAndSettle(subscription);
    expect(subscription.check()).toEqual({ isAllowed: true });
    expect(subscription.check("records", 99)).toEqual({ isAllowed: true });
    expect(subscription.check("records", 100)).toEqual({
      isAllowed: false,
      reason: "limit-reached",
      limit: "records",
      max: 100,
    });
    expect(subscription.check("export")).toMatchObject({ isAllowed: false });
    expect(subscription.check("unnamed", 10_000)).toEqual({ isAllowed: true });
    expect(subscription.check("toString")).toEqual({ isAllowed: true });
    expect(() => {
      subscription.require("records", 5);
    }).not.toThrow();
    expect(() => {
      subscription.require("records", 100);
    }).toThrow(/allows 100 for "records"/);
  });

  test("should refuse wrong arguments", () => {
    const { subscription } = setup();
    expect(() => subscription.check(7 as never)).toThrow(/limit must be/);
    expect(() => subscription.check("records", -1)).toThrow(/used must be/);
    expect(() => subscription.check("records", Number.NaN)).toThrow(
      /used must be/
    );
  });

  test("should end the license at its own expiry without the backend", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense({ trialDays: 30 });
    await startAndSettle(subscription);
    fake.answers.trial = offline();
    await vi.advanceTimersByTimeAsync(72 * HOUR_MS - MINUTE_MS);
    await settle();
    expect(subscription.isEntitled()).toBe(true);
    expect(subscription.getState()).toMatchObject({
      status: "trial",
      isOffline: true,
    });
    await vi.advanceTimersByTimeAsync(2 * MINUTE_MS);
    await settle();
    expect(subscription.isEntitled()).toBe(false);
    expect(subscription.getState()).toMatchObject({
      status: "unavailable",
      reason: "offline",
      limits: {},
    });
  });

  test("should end the trial at its end without the backend", async () => {
    const { subscription, fake } = setup();
    fake.answers.trial = trialLicense({ trialDays: 1 });
    await startAndSettle(subscription);
    fake.answers.trial = offline();
    await vi.advanceTimersByTimeAsync(DAY_MS + 1000);
    await settle();
    expect(subscription.getState()).toMatchObject({
      status: "trial-expired",
      trialEndedAt: START + DAY_MS,
    });
  });
});

describe("createSubscription schedule", () => {
  test("should renew on the interval and before half the license's life", async () => {
    const { subscription, fake } = setup({ refreshIntervalMs: 2 * DAY_MS });
    fake.answers.trial = trialLicense({ trialDays: 30 });
    await startAndSettle(subscription);
    await vi.advanceTimersByTimeAsync(36 * HOUR_MS - 1000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(fake.issueLicense).toHaveBeenCalledTimes(2);
  });

  test("should check the expiry again when its timer fires early", async () => {
    // A clock of its own that stands still while the timers run: the expiry timer fires
    // before the license expired by that clock, and waits again.
    const { subscription, fake } = setup({
      refreshIntervalMs: 7 * DAY_MS,
      now: () => START,
    });
    fake.answers.trial = trialLicense({ trialDays: 30 });
    await startAndSettle(subscription);
    fake.answers.trial = () => new Promise(() => undefined);
    await vi.advanceTimersByTimeAsync(72 * HOUR_MS + 1000);
    await settle();
    expect(subscription.getState()).toMatchObject({ status: "trial" });
    subscription.dispose();
  });
});

describe("createSubscription store and listeners", () => {
  test("should keep working in memory when the store cannot encrypt", async () => {
    const memory = createMemoryStore();
    memory.failWrites();
    const { subscription, fake, logger } = setup({}, { memory });
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    fake.answers.trial = trialLicense();
    await vi.advanceTimersByTimeAsync(5000);
    await subscription.refresh();
    await settle();
    expect(subscription.getState()).toMatchObject({ status: "trial" });
    expect(
      logger.warn.mock.calls.filter(([message]) =>
        String(message).includes("could not be stored")
      )
    ).toHaveLength(1);
  });

  test("should survive a listener that throws", async () => {
    const { subscription, fake, logger } = setup();
    const after = vi.fn();
    subscription.onChange(() => {
      throw new Error("listener bug");
    });
    const stop = subscription.onChange(after);
    fake.answers.trial = trialLicense();
    await startAndSettle(subscription);
    expect(after).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: a state listener threw",
      { error: "Error: listener bug" }
    );
    stop();
    stop();
  });

  test("should log what happened without the license or the device id", async () => {
    const { subscription, fake, logger } = setup();
    const issued = trialLicense();
    fake.answers.trial = issued;
    await startAndSettle(subscription);
    const written = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
    ]);
    expect(written).toContain("license issued");
    expect(written).not.toContain(issued.license);
    expect(written).not.toContain("device-0123");
  });
});
