import { describe, expect, test, vi } from "vitest";

import {
  EMPTY_RECORD,
  LICENSE_SECRET,
  readRecord,
  writeRecord,
} from "../../lib/main/license-store";
import { createMemoryStore } from "./subscription.fixture";

const VALID = {
  version: 1,
  license: "a.b.c",
  userId: 7,
  trialEndedAt: 1000,
  latestSeenAt: 2000,
};

describe("license-store", () => {
  test("should write and read a record", async () => {
    const { store } = createMemoryStore();
    await writeRecord(store, { ...VALID, version: 1 });
    expect(store.set).toHaveBeenCalledWith(
      LICENSE_SECRET,
      JSON.stringify(VALID)
    );
    expect(await readRecord(store)).toEqual(VALID);
  });

  test("should read nothing as the empty record", async () => {
    expect(await readRecord(createMemoryStore().store)).toBe(EMPTY_RECORD);
  });

  test("should read a store that fails as the empty record", async () => {
    const { store } = createMemoryStore();
    vi.mocked(store.get).mockRejectedValueOnce(new Error("broken"));
    expect(await readRecord(store)).toBe(EMPTY_RECORD);
  });

  test("should treat a foreign or damaged record as none", async () => {
    for (const text of [
      "not json",
      "null",
      "7",
      JSON.stringify({ ...VALID, version: 2 }),
      JSON.stringify({ ...VALID, license: 5 }),
      JSON.stringify({ ...VALID, userId: 1.5 }),
      JSON.stringify({ ...VALID, trialEndedAt: -1 }),
      JSON.stringify({ ...VALID, latestSeenAt: "now" }),
    ]) {
      const { store } = createMemoryStore({ [LICENSE_SECRET]: text });
      expect(await readRecord(store)).toBe(EMPTY_RECORD);
    }
  });

  test("should accept the nulls of a record without a license", async () => {
    const empty = { ...VALID, license: null, userId: null, trialEndedAt: null };
    const { store } = createMemoryStore({
      [LICENSE_SECRET]: JSON.stringify(empty),
    });
    expect(await readRecord(store)).toEqual(empty);
  });
});
