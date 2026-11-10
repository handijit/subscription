import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import createSubscriptionClient from "../../lib/renderer/create-subscription-client";
import type { SubscriptionClient } from "../../lib/renderer/create-subscription-client";
import type { SubscriptionState } from "../../lib/types";
import SubscriptionGate from "../../lib/ui/subscription-gate";
import {
  OFFERS,
  VALID_STATES,
  stateOf,
} from "../shared/subscription-state.fixture";
import mount from "./render.fixture";

const [LOADING, TRIAL, SUBSCRIBED] = VALID_STATES as [
  SubscriptionState,
  SubscriptionState,
  SubscriptionState,
];
const READY = { status: "ready", offers: [...OFFERS] } as const;
const EXPIRED = stateOf(
  { status: "trial-expired", trialEndedAt: 1 },
  { plans: READY }
);

const gate = (onSignIn?: () => void) => (client: SubscriptionClient) => (
  <SubscriptionGate
    client={client}
    productName="Notlar"
    onSignIn={onSignIn}
    titleBar={<span>pencere</span>}
  >
    <button type="button">program</button>
  </SubscriptionGate>
);

const programOf = (): HTMLElement =>
  screen.getByRole("button", { name: "program", hidden: true });

describe("SubscriptionGate", () => {
  test("should cover the program while main has not answered", () => {
    vi.stubGlobal("desktop", undefined);
    const client = createSubscriptionClient();
    render(gate()(client));
    expect(screen.getByText("Lisans denetleniyor…")).toBeTruthy();
    expect(programOf().parentElement?.hasAttribute("inert")).toBe(true);
  });

  test("should cover the program while loading", async () => {
    await mount(LOADING, gate());
    expect(screen.getByText("Lisans denetleniyor…")).toBeTruthy();
  });

  test("should render only the program during the trial and the subscription", async () => {
    const view = await mount(TRIAL, gate());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(programOf().parentElement?.hasAttribute("inert")).toBe(false);
    view.publish(SUBSCRIBED);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("should offer both plans at their prices once the trial is over", async () => {
    const view = await mount(EXPIRED, gate());
    const dialog = screen.getByRole("alertdialog", {
      name: "Deneme süreniz doldu",
    });
    expect(dialog.textContent).toContain(
      "Notlar programını kullanmaya devam etmek"
    );
    expect(dialog.textContent).toContain("₺149,90");
    expect(dialog.textContent).toContain("₺1.499");
    expect(dialog.textContent).toContain("%16 daha uygun");
    expect(dialog.textContent).toContain("Fiyatlara KDV dahildir.");
    expect(screen.getByText("pencere")).toBeTruthy();
    const monthly = screen.getByRole("button", { name: "Aylık abone ol" });
    await waitFor(() => {
      expect(document.activeElement).toBe(monthly);
    });
    fireEvent.click(screen.getByRole("button", { name: "Yıllık abone ol" }));
    expect(view.bridge.invoke["subscription:purchase"]).toHaveBeenCalledWith({
      interval: "yearly",
    });
  });

  test("should mark a plan that cannot be bought", async () => {
    await mount(
      stateOf(
        { status: "trial-expired", trialEndedAt: null },
        {
          plans: {
            status: "ready",
            offers: [
              { ...OFFERS[0], isAvailable: false },
              { ...OFFERS[1], isAvailable: false },
            ],
          },
        }
      ),
      gate()
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Aylık abone ol",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getAllByText("Şu anda satın alınamıyor")).toHaveLength(2);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("alertdialog"));
    });
  });

  test("should show no saving when the yearly plan is not cheaper", async () => {
    await mount(
      stateOf(
        { status: "trial-expired", trialEndedAt: null },
        {
          plans: {
            status: "ready",
            offers: [OFFERS[0], { ...OFFERS[1], priceKurus: 14_990 * 12 }],
          },
        }
      ),
      gate()
    );
    expect(screen.queryByText(/daha uygun/)).toBeNull();
  });

  test("should show one plan alone without featuring it", async () => {
    await mount(
      stateOf(
        { status: "trial-expired", trialEndedAt: null },
        { plans: { status: "ready", offers: [OFFERS[1]] } }
      ),
      gate()
    );
    expect(
      screen.getByRole("button", { name: "Yıllık abone ol" })
    ).toBeTruthy();
    expect(document.querySelector("[data-featured]")).toBeNull();
  });

  test("should say while the prices load", async () => {
    await mount(
      stateOf({ status: "trial-expired", trialEndedAt: null }),
      gate()
    );
    expect(screen.getByText("Fiyatlar yükleniyor…")).toBeTruthy();
  });

  test("should offer the plans without prices when they could not be read", async () => {
    const view = await mount(
      stateOf(
        { status: "trial-expired", trialEndedAt: null },
        { plans: { status: "failed", offers: [] } }
      ),
      gate()
    );
    expect(screen.getByText("Fiyatlar alınamadı.")).toBeTruthy();
    expect(screen.queryByText(/₺/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(view.bridge.invoke["subscription:load-plans"]).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Aylık abone ol" }));
    expect(view.bridge.invoke["subscription:purchase"]).toHaveBeenCalledWith({
      interval: "monthly",
    });
  });

  test("should say when the program is not on sale", async () => {
    await mount(
      stateOf(
        { status: "subscription-required" },
        { plans: { status: "ready", offers: [] } }
      ),
      gate()
    );
    expect(screen.getByText("Bu program şu anda satışta değil.")).toBeTruthy();
  });

  test("should offer sign-in to a signed-out user", async () => {
    const onSignIn = vi.fn();
    await mount(
      stateOf({ status: "subscription-required" }, { plans: READY }),
      gate(onSignIn)
    );
    expect(
      screen.getByRole("alertdialog", { name: "Abonelik gerekli" }).textContent
    ).toContain("Notlar abonelikle kullanılır.");
    expect(screen.getByText("Aboneliğiniz var mı?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  test("should offer no sign-in without the program's sign-in", async () => {
    await mount(
      stateOf({ status: "subscription-required" }, { plans: READY }),
      gate()
    );
    expect(screen.queryByRole("button", { name: "Giriş yap" })).toBeNull();
  });

  test("should offer a signed-in customer to manage the subscription", async () => {
    const view = await mount(
      stateOf(
        { status: "subscription-required" },
        { isSignedIn: true, plans: READY }
      ),
      gate(vi.fn())
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Hesabınızda Notlar için etkin bir abonelik yok."
    );
    expect(screen.queryByRole("button", { name: "Giriş yap" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aboneliği yönet" }));
    expect(view.bridge.invoke["subscription:manage"]).toHaveBeenCalled();
  });

  test("should name the device the subscription is bound to", async () => {
    const view = await mount(
      stateOf(
        {
          status: "device-mismatch",
          boundDevice: { name: "Muhasebe-PC", os: "windows" },
        },
        { isSignedIn: true }
      ),
      gate()
    );
    expect(
      screen.getByRole("alertdialog", {
        name: "Abonelik başka bir cihaza bağlı",
      }).textContent
    ).toContain("Aboneliğiniz Muhasebe-PC (Windows) cihazına bağlı.");
    fireEvent.click(
      screen.getByRole("button", { name: "Panelde cihazı değiştir" })
    );
    expect(view.bridge.invoke["subscription:manage"]).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(view.bridge.invoke["subscription:refresh"]).toHaveBeenCalled();
    view.publish(
      stateOf({
        status: "device-mismatch",
        boundDevice: { name: "Mac", os: "macos" },
      })
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Mac (macOS)"
    );
    view.publish(
      stateOf({
        status: "device-mismatch",
        boundDevice: { name: "Kutu", os: "linux" },
      })
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Kutu (linux)"
    );
    view.publish(
      stateOf({
        status: "device-mismatch",
        boundDevice: { name: "Kutu", os: null },
      })
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Aboneliğiniz Kutu cihazına"
    );
    view.publish(
      stateOf({
        status: "device-mismatch",
        boundDevice: { name: null, os: null },
      })
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Aboneliğiniz başka bir bilgisayara bağlı."
    );
  });

  test("should explain each reason no decision was reached", async () => {
    const view = await mount(
      stateOf({ status: "unavailable", reason: "offline" }),
      gate()
    );
    expect(
      screen.getByRole("alertdialog", { name: "İnternet bağlantısı gerekli" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(view.bridge.invoke["subscription:refresh"]).toHaveBeenCalled();
    for (const [reason, title] of [
      ["service", "Lisans sunucusuna ulaşılamıyor"],
      ["clock", "Bilgisayarın saati yanlış"],
      ["update-required", "Programın yeni sürümü gerekli"],
      ["license-invalid", "Lisans doğrulanamadı"],
    ] as const) {
      view.publish(stateOf({ status: "unavailable", reason }));
      expect(screen.getByRole("alertdialog", { name: title })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Yeniden dene" })).toBeTruthy();
    }
    view.publish(
      stateOf({ status: "unavailable", reason: "unsupported-platform" })
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "yalnızca Windows ve macOS"
    );
    expect(screen.queryByRole("button", { name: "Yeniden dene" })).toBeNull();
  });

  test("should show the pending purchase and let it be reopened or cancelled", async () => {
    const purchase = {
      interval: "yearly",
      startedAt: 1,
      expiresAt: 2,
    } as const;
    const view = await mount(
      stateOf(
        { status: "trial-expired", trialEndedAt: null },
        { plans: READY, purchase, isSignedIn: true }
      ),
      gate(vi.fn())
    );
    expect(screen.getByText("Ödeme bekleniyor")).toBeTruthy();
    expect(
      screen.getByText(/Ödeme tamamlanınca program kendiliğinden açılacak/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sayfayı yeniden aç" }));
    expect(view.bridge.invoke["subscription:purchase"]).toHaveBeenCalledWith({
      interval: "yearly",
    });
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(
      view.bridge.invoke["subscription:cancel-purchase"]
    ).toHaveBeenCalled();
  });

  test("should ask a signed-out buyer to sign in after paying", async () => {
    const purchase = {
      interval: "monthly",
      startedAt: 1,
      expiresAt: 2,
    } as const;
    await mount(
      stateOf(
        { status: "trial-expired", trialEndedAt: null },
        { plans: READY, purchase }
      ),
      (client) => (
        <SubscriptionGate
          client={client}
          productName="Notlar"
          onSignIn={vi.fn()}
          isSigningIn
        >
          <span />
        </SubscriptionGate>
      )
    );
    expect(
      screen.getByText(/bu programda da aynı hesapla giriş yapın/)
    ).toBeTruthy();
  });

  test("should take other texts", async () => {
    await mount(EXPIRED, (client) => (
      <SubscriptionGate
        client={client}
        productName="Notlar"
        labels={{
          trialExpiredTitle: "Trial over",
          buy: (interval) => `Buy ${interval}`,
        }}
      />
    ));
    expect(
      screen.getByRole("alertdialog", { name: "Trial over" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buy monthly" })).toBeTruthy();
  });

  test("should swallow an action main refuses", async () => {
    const view = await mount(EXPIRED, gate());
    view.bridge.invoke["subscription:purchase"].mockRejectedValueOnce(
      new Error("refused")
    );
    fireEvent.click(screen.getByRole("button", { name: "Aylık abone ol" }));
    await Promise.resolve();
    expect(view.bridge.invoke["subscription:purchase"]).toHaveBeenCalled();
  });
});
