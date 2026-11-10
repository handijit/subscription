import { z } from "zod";

import { PLAN_INTERVALS } from "../shared/subscription-state.constants";
import type { PlanOffer } from "../types";

/**
 * The answer of `GET /api/public/products/{slug}/plans`. Lenient on purpose: a plan of an
 * interval this version does not sell is skipped, not a contract error.
 */
const plansResponseSchema = z.array(
  z.object({
    interval: z.string(),
    priceKurus: z.number().int().nonnegative(),
    currency: z.string().min(1),
    available: z.boolean(),
  })
);

/** The plans this version sells, monthly first. */
const toPlanOffers = (
  plans: z.output<typeof plansResponseSchema>
): PlanOffer[] =>
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

export { plansResponseSchema, toPlanOffers };
