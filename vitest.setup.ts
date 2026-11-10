import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import type * as License from "@handijit/core/license";

import PENDING_CRYPTO from "./__tests__/support/pending-crypto";

// The real license verification, counted: the tests wait for it to finish (see `settle` in
// __tests__/main/subscription.fixture.ts) instead of for a fixed number of event-loop turns.
vi.mock("@handijit/core/license", async (importOriginal) => {
  const real = await importOriginal<typeof License>();
  const counted =
    <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      PENDING_CRYPTO.count += 1;
      return run(...args).finally(() => {
        PENDING_CRYPTO.count -= 1;
      });
    };
  return {
    ...real,
    verifyLicense: counted(real.verifyLicense),
    hashDeviceId: counted(real.hashDeviceId),
  };
});

afterEach(() => {
  // Without Vitest's globals Testing Library cannot register its own cleanup: a component
  // left mounted would keep its subscription into the next test.
  cleanup();
  vi.useRealTimers();
});
