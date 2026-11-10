import type { PublicPlan } from "@handijit/core";

import { PLAN_INTERVALS } from "../shared/subscription-state.constants";
import type { PlanOffer } from "../types";

/**
 * The plans this version sells, monthly first. A plan of an interval this version does not
 * sell is skipped, not a contract error.
 */
const toPlanOffers = (plans: readonly PublicPlan[]): PlanOffer[] =>
  PLAN_INTERVALS.flatMap((interval) => {
    const plan = plans.find((item) => item.interval === interval);
    return plan === undefined
      ? []
      : [
          {
            interval,
            priceKurus: plan.priceKurus,
            currency: plan.currency,
            isAvailable: plan.available,
          },
        ];
  });

export default toPlanOffers;
