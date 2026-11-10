/** Why `require` refused. */
type SubscriptionAccessCode = "NOT_ENTITLED" | "LIMIT_REACHED";

/**
 * Thrown by `subscription.require(...)`: main code asked to do something the license does not
 * allow. Its `code` says whether no license is in force or a limit is used up.
 */
class SubscriptionAccessError extends Error {
  /** `NOT_ENTITLED`: no license is in force; `LIMIT_REACHED`: the plan's limit is used up. */
  readonly code: SubscriptionAccessCode;
  /** The limit that was asked about; `null` when none was. */
  readonly limit: string | null;
  /** The plan's value of that limit; `null` when not entitled at all. */
  readonly max: number | null;

  constructor(
    code: SubscriptionAccessCode,
    limit: string | null,
    max: number | null
  ) {
    super(
      code === "NOT_ENTITLED"
        ? "subscription: no license is in force; the program must show the paywall"
        : `subscription: the plan allows ${String(max)} for "${String(limit)}" and that is used up`
    );
    this.name = "SubscriptionAccessError";
    this.code = code;
    this.limit = limit;
    this.max = max;
  }
}

export type { SubscriptionAccessCode };
export default SubscriptionAccessError;
