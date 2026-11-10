import type { PlanOffer } from "../types";

const LOCALE = "tr-TR";
const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** A price in kuruş as Turkish reads it: `₺149,90`. Whole liras drop the decimals: `₺1.490`. */
const formatPrice = ({ priceKurus, currency }: PlanOffer): string =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: priceKurus % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(priceKurus / 100);

/** A day: `12 Kasım 2026`. */
const formatDate = (moment: number): string => dateFormat.format(moment);

/** A day and a time: `12 Kasım 2026 14:05`. */
const formatDateTime = (moment: number): string =>
  dateTimeFormat.format(moment);

/**
 * The days left until a moment, as a person counts them: 6 days and 2 hours are 7 days, and
 * the last 24 hours are 0 ("the last day").
 */
const daysUntil = (moment: number, now: number): number => {
  const left = moment - now;
  return left < DAY_MS ? 0 : Math.ceil(left / DAY_MS);
};

/**
 * How much cheaper the yearly plan is than twelve months of the monthly one, in whole percent;
 * `null` when it is not cheaper or the two cannot be compared.
 */
const yearlySaving = (offers: readonly PlanOffer[]): number | null => {
  const monthly = offers.find((offer) => offer.interval === "monthly");
  const yearly = offers.find((offer) => offer.interval === "yearly");
  if (
    monthly === undefined ||
    yearly === undefined ||
    monthly.currency !== yearly.currency ||
    monthly.priceKurus <= 0
  ) {
    return null;
  }
  const percent = Math.floor(
    (1 - yearly.priceKurus / (monthly.priceKurus * 12)) * 100
  );
  return percent >= 1 ? percent : null;
};

export { daysUntil, formatDate, formatDateTime, formatPrice, yearlySaving };
