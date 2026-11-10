import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { SubscriptionState } from "../../lib/types";
import TrialBanner from "../../lib/ui/trial-banner";
import { VALID_STATES, stateOf } from "../shared/subscription-state.fixture";
import mount from "./render.fixture";

const [, , SUBSCRIBED] = VALID_STATES as [
  SubscriptionState,
  SubscriptionState,
  SubscriptionState,
];
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 10, 8);

const bannerOf = (): HTMLElement =>
  document.querySelector<HTMLElement>(".hds-banner") as HTMLElement;

const trialEndingIn = (ms: number): SubscriptionState =>
  stateOf({
    status: "trial",
    trialEndsAt: NOW + ms,
    licenseExpiresAt: NOW + DAY_MS,
  });

describe("TrialBanner", () => {
  test("should count the days left and buy the monthly plan", async () => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ["Date", "setInterval", "clearInterval"],
    });
    const view = await mount(trialEndingIn(5 * DAY_MS + 1000), (client) => (
      <TrialBanner client={client} className="ust" />
    ));
    const banner = bannerOf();
    expect(banner.textContent).toContain("Deneme sürümü: 5 gün kaldı.");
    expect(banner.getAttribute("data-tone")).toBe("info");
    expect(
      ["hds-banner", "ust"].every((name) =>
        (banner as Element).classList.contains(name)
      )
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Abone ol" }));
    expect(view.bridge.invoke["subscription:purchase"]).toHaveBeenCalledWith({
      interval: "monthly",
    });
    act(() => {
      vi.advanceTimersByTime(2000 + 60_000);
    });
    expect(banner.textContent).toContain("4 gün kaldı.");
  });

  test("should warn in the last days and on the last one", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const view = await mount(trialEndingIn(2 * DAY_MS), (client) => (
      <TrialBanner client={client} interval="yearly" />
    ));
    expect(bannerOf().getAttribute("data-tone")).toBe("warning");
    view.publish(trialEndingIn(3 * 60 * 60 * 1000));
    expect(bannerOf().textContent).toContain("Deneme süreniz bugün bitiyor.");
    fireEvent.click(screen.getByRole("button", { name: "Abone ol" }));
    expect(view.bridge.invoke["subscription:purchase"]).toHaveBeenCalledWith({
      interval: "yearly",
    });
  });

  test("should show a pending purchase", async () => {
    await mount(
      stateOf(
        {
          status: "trial",
          trialEndsAt: Date.now() + 9 * DAY_MS,
          licenseExpiresAt: 1,
        },
        { purchase: { interval: "monthly", startedAt: 1, expiresAt: 2 } }
      ),
      (client) => <TrialBanner client={client} warnDays={0} />
    );
    expect(bannerOf().getAttribute("data-tone")).toBe("info");
    expect(bannerOf().querySelector("button")?.textContent).toContain(
      "Abone ol"
    );
  });

  test("should swallow a purchase main refuses", async () => {
    const view = await mount(trialEndingIn(9 * DAY_MS), (client) => (
      <TrialBanner client={client} />
    ));
    view.bridge.invoke["subscription:purchase"].mockRejectedValueOnce(
      new Error("no")
    );
    fireEvent.click(screen.getByRole("button", { name: "Abone ol" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.bridge.invoke["subscription:purchase"]).toHaveBeenCalledTimes(
      1
    );
  });

  test("should render nothing outside the trial", async () => {
    const view = await mount(SUBSCRIBED, (client) => (
      <TrialBanner client={client} />
    ));
    expect(view.container.innerHTML).toBe("");
  });
});
