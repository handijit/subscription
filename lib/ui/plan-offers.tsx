import { Badge, Button, Spinner, UISize, UIVariant } from "@handijit/ui";
import type { ReactElement } from "react";

import { PLAN_INTERVALS } from "../shared/subscription-state.constants";
import type { PlanInterval, PlanOffer, SubscriptionState } from "../types";
import { formatPrice, yearlySaving } from "./format.helper";
import { ExternalIcon } from "./icons";
import type { SubscriptionLabels } from "./labels.constants";

type PlanOffersProps = {
  /** The state whose plans and pending purchase are shown. */
  state: SubscriptionState;
  /** The texts. */
  text: SubscriptionLabels;
  /** Buys a plan. */
  onBuy: (interval: PlanInterval) => void;
  /** Reads the plans again. */
  onRetry: () => void;
};

const PRIMARY = { "data-hds-primary": "" };

// Without prices (they could not be read) both plans can still be bought: the web page shows
// the price before anything is paid.
const UNPRICED: readonly PlanOffer[] = PLAN_INTERVALS.map((interval) => ({
  interval,
  priceKurus: 0,
  currency: "TRY",
  isAvailable: true,
}));

/** The plans of the paywall, side by side, yearly marked with its saving. */
const PlanOffers = ({
  state,
  text,
  onBuy,
  onRetry,
}: PlanOffersProps): ReactElement => {
  const { plans, purchase } = state;
  if (plans.status === "idle" || plans.status === "loading") {
    return (
      <div className="hds-plans__message" role="status">
        <Spinner size="sm" />
        <span>{text.plansLoading}</span>
      </div>
    );
  }
  if (plans.status === "ready" && plans.offers.length === 0) {
    return <p className="hds-plans__message">{text.noPlans}</p>;
  }

  const isPriced = plans.status === "ready";
  const offers = isPriced ? plans.offers : UNPRICED;
  const saving = isPriced ? yearlySaving(offers) : null;
  const firstAvailable = offers.find((offer) => offer.isAvailable)?.interval;

  return (
    <div className="hds-plans">
      {isPriced ? null : (
        <div className="hds-plans__message" role="status">
          <span>{text.plansFailed}</span>
          <Button
            variant={UIVariant.GHOST}
            size={UISize.XSMALL}
            onClick={onRetry}
          >
            {text.retry}
          </Button>
        </div>
      )}
      <ul className="hds-plans__list" data-count={offers.length}>
        {offers.map((offer) => {
          const isFeatured = offer.interval === "yearly" && offers.length > 1;
          return (
            <li
              key={offer.interval}
              className="hds-plan"
              data-featured={isFeatured ? "" : undefined}
            >
              <div className="hds-plan__head">
                <span className="hds-plan__name">
                  {text.planName(offer.interval)}
                </span>
                {offer.interval === "yearly" && saving !== null ? (
                  <Badge tone="success" variant="soft">
                    {text.saving(saving)}
                  </Badge>
                ) : null}
              </div>
              {isPriced ? (
                <p className="hds-plan__price">
                  <span className="hds-plan__amount">{formatPrice(offer)}</span>
                  <span className="hds-plan__period">
                    {text.perPeriod(offer.interval)}
                  </span>
                </p>
              ) : null}
              <Button
                variant={isFeatured ? UIVariant.ACCENT : UIVariant.SECONDARY}
                size={UISize.MEDIUM}
                isFullWidth
                disabled={!offer.isAvailable}
                isLoading={purchase?.interval === offer.interval}
                endIcon={<ExternalIcon />}
                onClick={() => {
                  onBuy(offer.interval);
                }}
                {...(offer.interval === firstAvailable ? PRIMARY : {})}
              >
                {text.buy(offer.interval)}
              </Button>
              {offer.isAvailable ? null : (
                <span className="hds-plan__note">{text.notForSale}</span>
              )}
            </li>
          );
        })}
      </ul>
      {isPriced ? <p className="hds-plans__note">{text.priceNote}</p> : null}
    </div>
  );
};

export type { PlanOffersProps };
export default PlanOffers;
