import { useSubscription } from "@handijit/subscription/react";
import type { SubscriptionClient } from "@handijit/subscription/react";
import { Button, UISize, UIVariant } from "@handijit/ui";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import type { PlanInterval } from "../types";
import { daysUntil } from "./format.helper";
import { ClockIcon } from "./icons";
import DEFAULT_SUBSCRIPTION_LABELS from "./labels.constants";
import type { SubscriptionLabels } from "./labels.constants";

type TrialBannerProps = {
  /** The client to read from. Default: the page's `subscriptionClient`. */
  client?: SubscriptionClient;
  /** The plan the "subscribe" button opens the page for. Default: `"monthly"`. */
  interval?: PlanInterval;
  /** From how many days left on the banner turns to a warning. Default: 2. */
  warnDays?: number;
  /** Replaces any of the Turkish texts. */
  labels?: Partial<SubscriptionLabels>;
  /**
   * `inline` (default): one row, for a strip above the content. `stacked`: a heading, the days
   * left and a full-width button under each other, for a sidebar's plan area.
   */
  layout?: "inline" | "stacked";
  /** Extra class on the banner. */
  className?: string;
};

const MINUTE_MS = 60_000;

/**
 * A slim banner during the trial: how many days are left and a "subscribe" button. Renders
 * nothing in any other status. Place it where the program shows notices, inside the gate:
 * `layout="stacked"` fits the plan area at the foot of a sidebar.
 */
const TrialBanner = ({
  client,
  interval = "monthly",
  warnDays = 2,
  labels,
  layout = "inline",
  className,
}: TrialBannerProps): ReactElement | null => {
  const { state, purchase } = useSubscription(client);
  const text = useMemo(
    () => ({ ...DEFAULT_SUBSCRIPTION_LABELS, ...labels }),
    [labels]
  );
  const [, setTick] = useState(0);
  const isTrial = state?.status === "trial";

  // The count of days changes at its own pace, not only when the state does: a render every
  // minute reads the clock again.
  useEffect(() => {
    if (!isTrial) return undefined;
    const timer = setInterval(() => {
      setTick((tick) => tick + 1);
    }, MINUTE_MS);
    return () => {
      clearInterval(timer);
    };
  }, [isTrial]);

  if (state?.status !== "trial") return null;
  const days = daysUntil(state.trialEndsAt, Date.now());

  const subscribeButton = (
    <Button
      variant={UIVariant.ACCENT}
      size={layout === "stacked" ? UISize.SMALL : UISize.XSMALL}
      isLoading={state.purchase !== null}
      onClick={() => {
        void purchase(interval).catch(() => undefined);
      }}
    >
      {text.subscribe}
    </Button>
  );

  return (
    <div
      className={["hds-banner", className].filter(Boolean).join(" ")}
      data-tone={days <= warnDays ? "warning" : "info"}
      data-layout={layout}
      role="status"
    >
      {layout === "stacked" ? (
        <>
          <span className="hds-banner__head">
            <ClockIcon />
            {text.trialTitle}
          </span>
          <span className="hds-banner__text">{text.trialDaysLeft(days)}</span>
        </>
      ) : (
        <>
          <ClockIcon />
          <span className="hds-banner__text">{text.trialLeft(days)}</span>
        </>
      )}
      {subscribeButton}
    </div>
  );
};

export type { TrialBannerProps };
export default TrialBanner;
