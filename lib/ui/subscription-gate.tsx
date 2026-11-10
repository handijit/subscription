import { useSubscription } from "@handijit/subscription/react";
import type { SubscriptionClient } from "@handijit/subscription/react";
import { Alert, Button, Spinner, UISize, UIVariant } from "@handijit/ui";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import type { PlanInterval, SubscriptionState } from "../types";
import {
  ClockIcon,
  DevicesIcon,
  ExternalIcon,
  KeyIcon,
  OfflineIcon,
} from "./icons";
import DEFAULT_SUBSCRIPTION_LABELS from "./labels.constants";
import type { SubscriptionLabels } from "./labels.constants";
import PlanOffers from "./plan-offers";

type SubscriptionGateProps = {
  /** The client to read from. Default: the page's `subscriptionClient`. */
  client?: SubscriptionClient;
  /** The program's name as the customer knows it, for the explanations. */
  productName: string;
  /** The program. It stays mounted behind the gate, inert, so nothing typed is lost. */
  children?: ReactNode;
  /**
   * Starts the program's sign-in (`useAuth().signIn` of `@handijit/auth`). Without it the gate
   * offers no sign-in; the customer can still buy on the web.
   */
  onSignIn?: () => void;
  /** Shows the sign-in button busy while the program's sign-in runs. */
  isSigningIn?: boolean;
  /** Shown along the top of the gate: the window controls of a frameless window. */
  titleBar?: ReactNode;
  /** Replaces any of the Turkish texts. */
  labels?: Partial<SubscriptionLabels>;
};

type Tone = "neutral" | "warning" | "danger";
// The statuses the gate covers the program for, with a panel.
type Blocking = Exclude<
  SubscriptionState,
  { status: "loading" | "trial" | "subscribed" }
>;
type GateBody = {
  icon: ReactNode;
  tone: Tone;
  title: string;
  text: string;
  offers?: boolean;
  actions?: ReactNode;
};

const PRIMARY = { "data-hds-primary": "" };

// A click must never become an unhandled rejection: without a bridge there is simply no answer.
const run = (action: () => Promise<unknown>) => (): void => {
  void action().catch(() => undefined);
};

const isLicensed = (state: SubscriptionState | null): boolean =>
  state?.status === "trial" || state?.status === "subscribed";

/**
 * The paywall of the program. While the license allows it (a trial or a subscription) it
 * renders its children and nothing else. Otherwise it covers the window and offers what can be
 * done: buy the monthly or yearly plan at its price, sign in, free the device on the web, or
 * try again. Until main has decided it shows a quiet "checking" cover.
 *
 * The gate only shows main's decision; main enforces it (`subscription.require`). Wrap the
 * program in it, once, at the top. Needs the styles of `@handijit/ui` and
 * `@handijit/subscription/styles.css`.
 */
const SubscriptionGate = ({
  client,
  productName,
  children,
  onSignIn,
  isSigningIn = false,
  titleBar,
  labels,
}: SubscriptionGateProps): ReactElement => {
  const { state, refresh, loadPlans, purchase, cancelPurchase, manage } =
    useSubscription(client);
  const text = useMemo(
    () => ({ ...DEFAULT_SUBSCRIPTION_LABELS, ...labels }),
    [labels]
  );
  const titleId = useId();
  const bodyId = useId();
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  const isCovering = !isLicensed(state);
  const status = state?.status;
  const isPending = (state?.purchase ?? null) !== null;

  // `inert` through the DOM: React 18 does not know the attribute and React 19 wants a
  // boolean, so neither spelling works on both.
  const setInert = useCallback(
    (node: HTMLElement | null): void => {
      node?.toggleAttribute("inert", isCovering);
    },
    [isCovering]
  );

  // Focus follows the one thing to do; when nothing can be done, the panel itself.
  useEffect(() => {
    if (panel === null) return;
    (panel.querySelector<HTMLElement>("[data-hds-primary]") ?? panel).focus();
  }, [panel, status, isPending]);

  const buy = (interval: PlanInterval): void => {
    run(() => purchase(interval))();
  };

  const retryButton = (
    current: SubscriptionState,
    isPrimary: boolean
  ): ReactNode => (
    <Button
      variant={isPrimary ? UIVariant.PRIMARY : UIVariant.SECONDARY}
      size={UISize.MEDIUM}
      isLoading={current.isRefreshing}
      onClick={run(refresh)}
      {...(isPrimary ? PRIMARY : {})}
    >
      {text.retry}
    </Button>
  );

  const bodyOf = (current: Blocking): GateBody => {
    switch (current.status) {
      case "trial-expired":
        return {
          icon: <ClockIcon size={24} />,
          tone: "warning",
          title: text.trialExpiredTitle,
          text: text.trialExpiredBody(productName),
          offers: true,
        };
      case "subscription-required":
        return {
          icon: <KeyIcon size={24} />,
          tone: "neutral",
          title: text.requiredTitle,
          text: current.isSignedIn
            ? text.requiredBodySignedIn(productName)
            : text.requiredBodySignedOut(productName),
          offers: true,
        };
      case "device-mismatch": {
        const { name, os } = current.boundDevice;
        const device =
          name === null ? null : os === null ? name : `${name} (${osName(os)})`;
        return {
          icon: <DevicesIcon size={24} />,
          tone: "warning",
          title: text.mismatchTitle,
          text: text.mismatchBody(device),
          actions: (
            <>
              <Button
                variant={UIVariant.PRIMARY}
                size={UISize.MEDIUM}
                endIcon={<ExternalIcon />}
                onClick={run(manage)}
                {...PRIMARY}
              >
                {text.releaseDevice}
              </Button>
              {retryButton(current, false)}
            </>
          ),
        };
      }
      case "unavailable": {
        const { reason } = current;
        const isConnection = reason === "offline" || reason === "service";
        return {
          icon:
            reason === "clock" ? (
              <ClockIcon size={24} />
            ) : isConnection ? (
              <OfflineIcon size={24} />
            ) : (
              <KeyIcon size={24} />
            ),
          tone: isConnection ? "neutral" : "danger",
          title: text.unavailableTitle(reason),
          text: text.unavailableBody(reason),
          actions:
            reason === "unsupported-platform"
              ? undefined
              : retryButton(current, true),
        };
      }
    }
  };

  const renderPending = (current: SubscriptionState): ReactNode => {
    const { purchase: pending } = current;
    return pending === null ? null : (
      <div className="hds-gate__pending">
        <Alert tone="info" title={text.purchasePendingTitle}>
          {current.isSignedIn
            ? text.purchasePendingBody
            : text.purchasePendingSignIn}
          <span className="hds-gate__pending-actions">
            <Button
              variant={UIVariant.GHOST}
              size={UISize.XSMALL}
              onClick={() => {
                buy(pending.interval);
              }}
            >
              {text.reopenPage}
            </Button>
            <Button
              variant={UIVariant.GHOST}
              size={UISize.XSMALL}
              onClick={run(cancelPurchase)}
            >
              {text.cancel}
            </Button>
          </span>
        </Alert>
      </div>
    );
  };

  const renderPanel = (current: Blocking): ReactElement => {
    const body = bodyOf(current);
    const canSignIn =
      body.offers === true && !current.isSignedIn && onSignIn !== undefined;
    const canManage = body.offers === true && current.isSignedIn;
    return (
      <div
        ref={setPanel}
        className="hds-gate__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <span className="hds-gate__emblem" data-tone={body.tone}>
          {body.icon}
        </span>
        <h1 id={titleId} className="hds-gate__title">
          {body.title}
        </h1>
        <p id={bodyId} className="hds-gate__text">
          {body.text}
        </p>
        {renderPending(current)}
        {body.offers === true ? (
          <PlanOffers
            state={current}
            text={text}
            onBuy={buy}
            onRetry={run(loadPlans)}
          />
        ) : null}
        {body.actions === undefined ? null : (
          <div className="hds-gate__actions">{body.actions}</div>
        )}
        {canSignIn || canManage ? (
          <div className="hds-gate__footer">
            {canSignIn ? (
              <>
                <span>{text.haveSubscription}</span>
                <Button
                  variant={
                    current.purchase === null
                      ? UIVariant.GHOST
                      : UIVariant.PRIMARY
                  }
                  size={UISize.SMALL}
                  isLoading={isSigningIn}
                  onClick={onSignIn}
                >
                  {text.signIn}
                </Button>
              </>
            ) : (
              <Button
                variant={UIVariant.GHOST}
                size={UISize.SMALL}
                endIcon={<ExternalIcon />}
                onClick={run(manage)}
              >
                {text.manage}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderGate = (current: SubscriptionState | null): ReactElement => (
    <div className="hds-gate" data-status={current?.status ?? "loading"}>
      {titleBar === undefined ? null : (
        <div className="hds-gate__bar">{titleBar}</div>
      )}
      {current === null || current.status === "loading" ? (
        <div className="hds-gate__checking" role="status">
          <Spinner size="md" />
          <span>{text.checking}</span>
        </div>
      ) : (
        // Only reached while covering: neither a trial nor a subscription.
        renderPanel(current as Blocking)
      )}
    </div>
  );

  return (
    <>
      <div ref={setInert} className="hds-gate__content">
        {children}
      </div>
      {isCovering ? renderGate(state) : null}
    </>
  );
};

const OS_NAMES: Readonly<Record<string, string>> = {
  windows: "Windows",
  macos: "macOS",
};
const osName = (os: string): string => OS_NAMES[os] ?? os;

export type { SubscriptionGateProps };
export default SubscriptionGate;
