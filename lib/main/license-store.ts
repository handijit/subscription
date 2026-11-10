import type { SubscriptionSecretStore } from "./types";

/** The secret the license record is kept under. */
const LICENSE_SECRET = "subscription-license";

/** What is kept between starts. Never shown to the renderer. */
type LicenseRecord = {
  /** The format of the record. */
  readonly version: 1;
  /** The last license that verified; `null` when none is held. */
  readonly license: string | null;
  /** The customer a paid license was issued to; `null` for a trial license. */
  readonly userId: number | null;
  /** When the backend said the trial ended; kept so that an offline start still knows. */
  readonly trialEndedAt: number | null;
  /** The latest moment this installation has seen (epoch milliseconds): the clock guard. */
  readonly latestSeenAt: number;
};

const EMPTY_RECORD: LicenseRecord = {
  version: 1,
  license: null,
  userId: null,
  trialEndedAt: null,
  latestSeenAt: 0,
};

const isMoment = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

// A record that is not exactly this shape is treated as none: it was written by a future
// version or damaged, and the backend will issue a new license anyway.
const parseRecord = (text: string | null): LicenseRecord => {
  if (text === null) return EMPTY_RECORD;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return EMPTY_RECORD;
    const record = value as Record<string, unknown>;
    if (
      record.version !== 1 ||
      !(record.license === null || typeof record.license === "string") ||
      !(record.userId === null || Number.isSafeInteger(record.userId)) ||
      !(record.trialEndedAt === null || isMoment(record.trialEndedAt)) ||
      !isMoment(record.latestSeenAt)
    ) {
      return EMPTY_RECORD;
    }
    return {
      version: 1,
      license: record.license,
      userId: record.userId as number | null,
      trialEndedAt: record.trialEndedAt,
      latestSeenAt: record.latestSeenAt,
    };
  } catch {
    return EMPTY_RECORD;
  }
};

/** Reads the stored record; an absent, unreadable or foreign one is the empty record. */
const readRecord = async (
  store: SubscriptionSecretStore
): Promise<LicenseRecord> =>
  parseRecord(await store.get(LICENSE_SECRET).catch(() => null));

/** Writes the record. Rejects when the store cannot encrypt it. */
const writeRecord = (
  store: SubscriptionSecretStore,
  record: LicenseRecord
): Promise<void> => store.set(LICENSE_SECRET, JSON.stringify(record));

export type { LicenseRecord };
export { EMPTY_RECORD, LICENSE_SECRET, readRecord, writeRecord };
