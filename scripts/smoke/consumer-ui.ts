// The components, as a page uses them. Checked with the bundler resolution only: a page is
// always bundled.
import { createSubscriptionClient } from "@handijit/subscription/renderer";
import {
  DEFAULT_SUBSCRIPTION_LABELS,
  SubscriptionGate,
  SubscriptionStatus,
  TrialBanner,
  type SubscriptionGateProps,
  type SubscriptionLabels,
  type TrialBannerProps,
} from "@handijit/subscription/ui";
import { createElement, type ReactElement } from "react";

const client = createSubscriptionClient();
const labels: SubscriptionLabels = {
  ...DEFAULT_SUBSCRIPTION_LABELS,
  retry: "Tekrar dene",
};
const bannerProps: TrialBannerProps = {
  client,
  interval: "yearly",
  warnDays: 3,
};
const gateProps: SubscriptionGateProps = {
  productName: "Ön Muhasebe",
  labels,
  onSignIn: () => undefined,
};
const page: ReactElement = createElement(
  SubscriptionGate,
  gateProps,
  createElement(TrialBanner, bannerProps),
  createElement(SubscriptionStatus, { client })
);

// @ts-expect-error the gate needs the program's name
createElement(SubscriptionGate, {});
// @ts-expect-error a plan that is not sold must not compile
const wrong: TrialBannerProps = { interval: "weekly" };

export { page, wrong };
