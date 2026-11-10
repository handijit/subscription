import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  DAY_MS,
  DEVICE_ID,
  HOUR_MS,
  MINUTE_MS,
  NEXT_SIGNER,
  SIGNER,
  START,
  createElectronMock,
  createMemoryStore,
  offline,
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

const storedTrial = (latestSeenAt: number) => {
  const issued = trialLicense({ issuedAt: START - HOUR_MS });
  return createMemoryStore({
    "subscription-license": JSON.stringify({
      version: 1,
      license: issued.license,
      userId: null,
      trialEndedAt: null,
      latestSeenAt,
    }),
  });
};

beforeEach(() => {
  Object.assign(electron, createElectronMock());
  useClock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSubscription clock guard", () => {
  test("should not trust the stored license after the clock was turned back", async () => {
    const memory = storedTrial(START + DAY_MS);
    const { subscription, fake, logger } = setup({}, { memory });
    fake.answers.trial = offline();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "clock",
    });
    expect(subscription.isEntitled()).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "subscription: the clock was turned back",
      { behindMs: DAY_MS }
    );
  });

  test("should tolerate a clock that is a few minutes behind", async () => {
    const memory = storedTrial(START + 4 * MINUTE_MS);
    const { subscription, fake } = setup({}, { memory });
    fake.answers.trial = offline();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
    });
  });

  test("should trust the clock again once a fresh license verifies", async () => {
    const memory = storedTrial(START + DAY_MS);
    const { subscription, fake } = setup({}, { memory });
    fake.answers.trial = trialLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
    });
    expect(memory.record()).toMatchObject({ latestSeenAt: START });
  });

  test("should stay blocked while the backend's time says the clock is wrong", async () => {
    const memory = storedTrial(START + DAY_MS);
    const { subscription, fake } = setup({}, { memory });
    const serverNow = START + DAY_MS;
    fake.answers.trial = SIGNER.issue(
      {
        deviceId: DEVICE_ID,
        plan: "trial",
        issuedAt: serverNow,
        trialEndsAt: serverNow + 6 * DAY_MS,
        expiresAt: serverNow + 3 * DAY_MS,
      },
      serverNow
    );
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "clock",
    });
  });

  test("should notice a clock turned back while the program runs", async () => {
    const { subscription, fake, logger } = setup();
    fake.answers.trial = trialLicense({ trialDays: 30 });
    await startAndSettle(subscription);
    fake.answers.trial = offline();
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    vi.setSystemTime(Date.now() - 2 * HOUR_MS);
    expect(subscription.isEntitled()).toBe(false);
    expect(subscription.getState()).toMatchObject({ reason: "clock" });
    subscription.check();
    expect(
      logger.warn.mock.calls.filter(([message]) =>
        String(message).includes("clock was turned back")
      )
    ).toHaveLength(1);
  });

  test("should write down the latest moment seen every ten minutes of use", async () => {
    const { subscription, fake, memory } = setup();
    fake.answers.trial = trialLicense({ trialDays: 30 });
    await startAndSettle(subscription);
    await vi.advanceTimersByTimeAsync(9 * MINUTE_MS);
    subscription.isEntitled();
    await settle();
    expect(memory.record()).toMatchObject({ latestSeenAt: START });
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    subscription.isEntitled();
    await settle();
    expect(memory.record()).toMatchObject({
      latestSeenAt: START + 10 * MINUTE_MS,
    });
  });
});

describe("createSubscription key rotation", () => {
  test("should accept the next key and replace a license of the previous one", async () => {
    const memory = storedTrial(START);
    const { subscription, fake } = setup({}, { memory });
    const next = trialLicense({ signer: NEXT_SIGNER });
    fake.answers.trial = next;
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "trial",
    });
    expect(memory.record()).toMatchObject({ license: next.license });
  });

  test("should refuse a key that is not built in, even if it is the only one", async () => {
    const { subscription, fake } = setup({ keys: [NEXT_SIGNER.key] });
    fake.answers.trial = trialLicense();
    expect(await startAndSettle(subscription)).toMatchObject({
      status: "unavailable",
      reason: "update-required",
    });
  });
});
