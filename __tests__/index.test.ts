import { describe, expect, test, vi } from "vitest";

import * as shared from "../lib/index";
import * as main from "../lib/main";
import * as preload from "../lib/preload";
import * as react from "../lib/react";
import * as renderer from "../lib/renderer";
import { UNAVAILABLE_REASONS } from "../lib/shared/subscription-state.constants";
import * as ui from "../lib/ui";

// The barrels only re-export; `electron` is mocked so that importing them has no side effect.
vi.mock("electron", () => ({
  app: {},
  ipcMain: {},
  powerMonitor: {},
  shell: {},
  webContents: {},
}));

const names = (module: object): string[] => Object.keys(module).sort();

describe("the public API", () => {
  test("sentinel: the shared entry should export exactly its documented names", () => {
    expect(names(shared)).toEqual([
      "PLANS_STATUSES",
      "PLAN_INTERVALS",
      "SUBSCRIPTION_CHANNELS",
      "SUBSCRIPTION_STATUSES",
      "UNAVAILABLE_REASONS",
      "isSubscriptionState",
      "withSubscriptionChannels",
    ]);
  });

  test("sentinel: the main entry should export exactly its documented names", () => {
    expect(names(main)).toEqual([
      "SubscriptionAccessError",
      "createSubscription",
      "createSubscriptionHandlers",
      "registerSubscriptionIpc",
      "subscriptionContract",
    ]);
  });

  test("sentinel: the preload entry should export exactly its documented names", () => {
    expect(names(preload)).toEqual([
      "SUBSCRIPTION_CHANNELS",
      "withSubscriptionChannels",
    ]);
  });

  test("sentinel: the renderer entry should export exactly its documented names", () => {
    expect(names(renderer)).toEqual([
      "createSubscriptionClient",
      "isSubscriptionState",
      "subscriptionClient",
    ]);
  });

  test("sentinel: the react entry should export exactly its documented names", () => {
    expect(names(react)).toEqual(["useSubscription"]);
  });

  test("sentinel: the ui entry should export exactly its documented names", () => {
    expect(names(ui)).toEqual([
      "DEFAULT_SUBSCRIPTION_LABELS",
      "SubscriptionGate",
      "SubscriptionStatus",
      "TrialBanner",
    ]);
  });

  test("should hand the same values out of every entry that has them", () => {
    expect(preload.SUBSCRIPTION_CHANNELS).toBe(shared.SUBSCRIPTION_CHANNELS);
    expect(preload.withSubscriptionChannels).toBe(
      shared.withSubscriptionChannels
    );
    expect(renderer.isSubscriptionState).toBe(shared.isSubscriptionState);
  });

  test("should have a Turkish text for every label and every case", () => {
    const plans = [["monthly"], ["yearly"]];
    const samples: Readonly<Record<string, readonly unknown[][]>> = {
      trialExpiredBody: [["Notlar"]],
      requiredBodySignedIn: [["Notlar"]],
      requiredBodySignedOut: [["Notlar"]],
      mismatchBody: [["Muhasebe-PC"], [null]],
      unavailableTitle: UNAVAILABLE_REASONS.map((reason) => [reason]),
      unavailableBody: UNAVAILABLE_REASONS.map((reason) => [reason]),
      planName: plans,
      perPeriod: plans,
      buy: plans,
      saving: [[16]],
      trialLeft: [[0], [5]],
      trialDaysLeft: [[0], [5]],
      statusName: [
        ["loading", null],
        ["trial", null],
        ["subscribed", "monthly"],
        ["subscribed", null],
        ["trial-expired", null],
        ["subscription-required", null],
        ["device-mismatch", null],
        ["unavailable", null],
      ],
      trialEndsOn: [["12 Kasım 2026"]],
      validUntil: [["12 Kasım 2026"]],
      checkedOn: [["12 Kasım 2026"]],
    };
    for (const [name, label] of Object.entries(
      ui.DEFAULT_SUBSCRIPTION_LABELS
    )) {
      const texts =
        typeof label === "function"
          ? (samples[name] ?? []).map((args) =>
              (label as (...values: unknown[]) => unknown)(...args)
            )
          : [label];
      expect([name, texts.length > 0]).toEqual([name, true]);
      for (const text of texts) {
        expect([
          name,
          typeof text === "string" && text.trim().length > 0,
        ]).toEqual([name, true]);
      }
    }
  });
});
