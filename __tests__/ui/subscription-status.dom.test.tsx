import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import createSubscriptionClient from "../../lib/renderer/create-subscription-client";
import SubscriptionStatus from "../../lib/ui/subscription-status";
import { START, stateOf } from "../shared/subscription-state.fixture";
import mount from "./render.fixture";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("SubscriptionStatus", () => {
  test("should say it is checking before main answers", () => {
    vi.stubGlobal("desktop", undefined);
    render(<SubscriptionStatus client={createSubscriptionClient()} />);
    expect(screen.getByText("Denetleniyor")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  test("should show the trial's end, the license's validity and the last check", async () => {
    const view = await mount(
      stateOf(
        {
          status: "trial",
          trialEndsAt: START + 5 * DAY_MS,
          licenseExpiresAt: START + 3 * DAY_MS,
        },
        { checkedAt: START }
      ),
      (client) => <SubscriptionStatus client={client} className="ayar" />
    );
    expect(screen.getByText("Deneme sürümü")).toBeTruthy();
    const lines = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Deneme 15 Kasım 2026 tarihinde bitiyor$/);
    expect(lines[1]).toMatch(
      /^Lisans 13 Kasım 2026 .* tarihine kadar çevrimdışı geçerli$/
    );
    expect(lines[2]).toMatch(/^Son denetim 10 Kasım 2026/);
    expect(
      ["hds-status", "ayar"].every((name) =>
        (view.container.firstChild as Element).classList.contains(name)
      )
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Aboneliği yönet" }));
    expect(view.bridge.invoke["subscription:manage"]).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Lisansı yenile" }));
    expect(view.bridge.invoke["subscription:refresh"]).toHaveBeenCalled();
  });

  test("should name the plan and say when it is offline", async () => {
    const view = await mount(
      stateOf(
        {
          status: "subscribed",
          plan: "yearly",
          licenseExpiresAt: START + DAY_MS,
        },
        { isOffline: true, checkedAt: null }
      ),
      (client) => <SubscriptionStatus client={client} />
    );
    expect(screen.getByText("Yıllık abonelik")).toBeTruthy();
    expect(screen.getByText("Çevrimdışı")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    view.publish(
      stateOf({
        status: "device-mismatch",
        boundDevice: { name: null, os: null },
      })
    );
    expect(screen.getByText("Başka cihaza bağlı")).toBeTruthy();
    expect(screen.queryByText("Çevrimdışı")).toBeNull();
  });

  test("should swallow actions main refuses", async () => {
    const view = await mount(
      stateOf({ status: "trial-expired", trialEndedAt: null }),
      (client) => <SubscriptionStatus client={client} />
    );
    view.bridge.invoke["subscription:manage"].mockRejectedValueOnce(
      new Error("no")
    );
    view.bridge.invoke["subscription:refresh"].mockRejectedValueOnce(
      new Error("no")
    );
    fireEvent.click(screen.getByRole("button", { name: "Aboneliği yönet" }));
    fireEvent.click(screen.getByRole("button", { name: "Lisansı yenile" }));
    await Promise.resolve();
    expect(screen.getByText("Deneme süresi doldu")).toBeTruthy();
  });
});
