// The page of the fixture program: the gate around a notes screen with the trial banner and
// the status block, and the sign-in of @handijit/auth behind the gate's button. Main drives
// it through executeJavaScript and reads the answers; every function returns plain data.
import "@handijit/design/fonts.css";
import "@handijit/design/tokens.css";
import "@handijit/ui/styles.css";
import "@handijit/subscription/styles.css";

import { useAuth } from "@handijit/auth/react";
import { subscriptionClient } from "@handijit/subscription/renderer";
import {
  SubscriptionGate,
  SubscriptionStatus,
  TrialBanner,
} from "@handijit/subscription/ui";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";

type Bridge = {
  invoke: Record<string, unknown>;
  on: Record<string, unknown>;
};

const smoke = {
  // Every status the page showed, without the repeats of a double render.
  statuses: [] as string[],
  bridge: () => {
    const { desktop } = globalThis as unknown as { desktop: Bridge };
    return {
      invoke: Object.keys(desktop.invoke).sort(),
      on: Object.keys(desktop.on).sort(),
    };
  },
  state: () => subscriptionClient.getState(),
  gate: () => {
    const dialog = document.querySelector<HTMLElement>(
      ".hds-gate [role=alertdialog]"
    );
    return dialog === null
      ? null
      : {
          title: dialog.querySelector("h1")?.textContent ?? "",
          text: dialog.innerText,
        };
  },
  isCovered: () => document.querySelector(".hds-gate") !== null,
  isProgramInert: () =>
    document.querySelector("#work")?.closest("[inert]") !== null,
  banner: () =>
    document.querySelector<HTMLElement>(".hds-banner")?.innerText ?? null,
  status: () =>
    document.querySelector<HTMLElement>(".hds-status")?.innerText ?? null,
  // What a person can press: not behind the gate, not disabled.
  buttons: () =>
    [...document.querySelectorAll("button")]
      .filter(
        (button) => button.closest("[inert]") === null && !button.disabled
      )
      .map((button) => button.innerText.trim()),
  click: (label: string): boolean => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) =>
        candidate.closest("[inert]") === null &&
        !candidate.disabled &&
        candidate.innerText.trim() === label
    );
    button?.click();
    return button !== undefined;
  },
  hasNode:
    typeof (globalThis as Record<string, unknown>).require !== "undefined" ||
    typeof (globalThis as Record<string, unknown>).process !== "undefined",
};
(globalThis as unknown as { __smoke: typeof smoke }).__smoke = smoke;

subscriptionClient.subscribe((state) => {
  if (smoke.statuses.at(-1) !== state.status) smoke.statuses.push(state.status);
});

const App = (): ReactElement => {
  const auth = useAuth();
  return (
    <SubscriptionGate
      productName="Notlar"
      onSignIn={() => {
        void auth.signIn();
      }}
      isSigningIn={auth.status === "signing-in"}
    >
      <header id="title-bar">
        <TrialBanner />
      </header>
      <main>
        <button type="button" id="work">
          Not ekle
        </button>
        <SubscriptionStatus />
        <output id="auth">{auth.status}</output>
      </main>
    </SubscriptionGate>
  );
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
