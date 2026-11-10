import { useSubscription } from "@handijit/subscription/react";
import type { SubscriptionClient } from "@handijit/subscription/react";
import { Badge, Button, UISize, UIVariant } from "@handijit/ui";
import type { BadgeTone } from "@handijit/ui";
import { useMemo } from "react";
import type { ReactElement } from "react";

import type {
  SubscriptionState,
  SubscriptionStatus as StatusName,
} from "../types";
import { formatDate, formatDateTime } from "./format.helper";
import { ExternalIcon, OfflineIcon } from "./icons";
import DEFAULT_SUBSCRIPTION_LABELS from "./labels.constants";
import type { SubscriptionLabels } from "./labels.constants";

type SubscriptionStatusProps = {
  /** The client to read from. Default: the page's `subscriptionClient`. */
  client?: SubscriptionClient;
  /** Replaces any of the Turkish texts. */
  labels?: Partial<SubscriptionLabels>;
  /** Extra class on the block. */
  className?: string;
};

const TONES: Readonly<Record<StatusName, BadgeTone>> = {
  loading: "neutral",
  trial: "info",
  subscribed: "success",
  "trial-expired": "warning",
  "subscription-required": "warning",
  "device-mismatch": "warning",
  unavailable: "danger",
};

/**
 * A compact block for the program's settings page: the plan, until when the license holds,
 * the last check, and the buttons to manage the subscription on the web and to renew the
 * license now.
 */
const SubscriptionStatus = ({
  client,
  labels,
  className,
}: SubscriptionStatusProps): ReactElement => {
  const { state, refresh, manage } = useSubscription(client);
  const text = useMemo(
    () => ({ ...DEFAULT_SUBSCRIPTION_LABELS, ...labels }),
    [labels]
  );
  const status = state?.status ?? "loading";

  const lines = (current: SubscriptionState | null): string[] => {
    if (current === null) return [];
    return [
      ...(current.status === "trial"
        ? [text.trialEndsOn(formatDate(current.trialEndsAt))]
        : []),
      ...(current.status === "trial" || current.status === "subscribed"
        ? [text.validUntil(formatDateTime(current.licenseExpiresAt))]
        : []),
      ...(current.checkedAt === null
        ? []
        : [text.checkedOn(formatDateTime(current.checkedAt))]),
    ];
  };

  return (
    <section
      className={["hds-status", className].filter(Boolean).join(" ")}
      data-status={status}
    >
      <div className="hds-status__head">
        <Badge tone={TONES[status]} variant="soft">
          {text.statusName(
            status,
            state?.status === "subscribed" ? state.plan : null
          )}
        </Badge>
        {state?.isOffline === true ? (
          <Badge
            tone="neutral"
            variant="outline"
            icon={<OfflineIcon size={12} />}
          >
            {text.offline}
          </Badge>
        ) : null}
      </div>
      <ul className="hds-status__lines">
        {lines(state).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="hds-status__actions">
        <Button
          variant={UIVariant.SECONDARY}
          size={UISize.SMALL}
          endIcon={<ExternalIcon />}
          onClick={() => {
            void manage().catch(() => undefined);
          }}
        >
          {text.manage}
        </Button>
        <Button
          variant={UIVariant.GHOST}
          size={UISize.SMALL}
          isLoading={state?.isRefreshing === true}
          onClick={() => {
            void refresh().catch(() => undefined);
          }}
        >
          {text.refresh}
        </Button>
      </div>
    </section>
  );
};

export type { SubscriptionStatusProps };
export default SubscriptionStatus;
