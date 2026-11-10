import { createUrlPolicy } from "@handijit/electron/main";
import { beforeEach, describe, expect, test, vi } from "vitest";

import subscriptionContract from "../../lib/main/subscription-contract";
import registerSubscriptionIpc, {
  createSubscriptionHandlers,
} from "../../lib/main/subscription-ipc";
import type { Subscription } from "../../lib/main/types";
import type { SubscriptionState } from "../../lib/types";
import { VALID_STATES } from "../shared/subscription-state.fixture";

type InvokeListener = (event: unknown, ...parameters: unknown[]) => unknown;

const { electron, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, InvokeListener>();
  const electron = {
    app: { isPackaged: true },
    ipcMain: {
      handle: vi.fn((channel: string, listener: InvokeListener): void => {
        listeners.set(channel, listener);
      }),
      removeHandler: vi.fn((channel: string): void => {
        listeners.delete(channel);
      }),
    },
    webContents: { getAllWebContents: vi.fn<() => unknown[]>(() => []) },
  };
  return { electron, listeners };
});

vi.mock("electron", () => electron);

const APP_PAGE = "app://bundle/index.html";
const [LOADING, TRIAL] = VALID_STATES as [SubscriptionState, SubscriptionState];

const createFakeSubscription = () => {
  const changeListeners = new Set<(state: SubscriptionState) => void>();
  const subscription = {
    getState: vi.fn<Subscription["getState"]>(() => LOADING),
    onChange: vi.fn<Subscription["onChange"]>((listener) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    }),
    start: vi.fn<Subscription["start"]>(() => Promise.resolve(LOADING)),
    refresh: vi.fn<Subscription["refresh"]>(() => Promise.resolve(TRIAL)),
    isEntitled: vi.fn<Subscription["isEntitled"]>(() => true),
    check: vi.fn<Subscription["check"]>(() => ({ isAllowed: true })),
    require: vi.fn<Subscription["require"]>(),
    loadPlans: vi.fn<Subscription["loadPlans"]>(() => Promise.resolve(TRIAL)),
    purchase: vi.fn<Subscription["purchase"]>(() => Promise.resolve(true)),
    cancelPurchase: vi.fn<Subscription["cancelPurchase"]>(() => TRIAL),
    manage: vi.fn<Subscription["manage"]>(() => Promise.resolve(false)),
    dispose: vi.fn<Subscription["dispose"]>(),
  };
  return {
    subscription,
    publish: (state: SubscriptionState): void => {
      for (const listener of changeListeners) listener(state);
    },
    listenerCount: (): number => changeListeners.size,
  };
};

const createPage = (url: string) => ({
  isDestroyed: vi.fn(() => false),
  getURL: vi.fn(() => url),
  send: vi.fn<(channel: string, payload: unknown) => void>(),
});

const invokeFrom = (
  frameUrl: string,
  channel: string,
  ...parameters: unknown[]
): unknown => {
  const listener = listeners.get(channel);
  if (listener === undefined) throw new Error(`no handler for ${channel}`);
  return listener({ senderFrame: { url: frameUrl } }, ...parameters);
};

beforeEach(() => {
  listeners.clear();
});

describe("createSubscriptionHandlers", () => {
  test("should map every channel of the contract to the subscription, and nothing else", async () => {
    const { subscription } = createFakeSubscription();
    const handlers = createSubscriptionHandlers(subscription);
    const event = {} as never;
    expect(Object.keys(handlers).sort()).toEqual(
      Object.keys(subscriptionContract.invoke).sort()
    );
    expect(await handlers["subscription:get-state"](undefined, event)).toBe(
      LOADING
    );
    expect(await handlers["subscription:refresh"](undefined, event)).toBe(
      TRIAL
    );
    expect(await handlers["subscription:load-plans"](undefined, event)).toBe(
      TRIAL
    );
    expect(
      await handlers["subscription:purchase"]({ interval: "yearly" }, event)
    ).toBe(true);
    expect(
      await handlers["subscription:cancel-purchase"](undefined, event)
    ).toBe(TRIAL);
    expect(await handlers["subscription:manage"](undefined, event)).toBe(false);
    expect(subscription.purchase).toHaveBeenCalledWith("yearly");
  });
});

describe("registerSubscriptionIpc", () => {
  test("should answer the program's page with the validated state", async () => {
    const { subscription } = createFakeSubscription();
    registerSubscriptionIpc({ subscription, policy: createUrlPolicy() });
    expect([...listeners.keys()].sort()).toEqual(
      Object.keys(subscriptionContract.invoke).sort()
    );
    expect(await invokeFrom(APP_PAGE, "subscription:get-state")).toEqual(
      LOADING
    );
    expect(
      await invokeFrom(APP_PAGE, "subscription:purchase", {
        interval: "monthly",
      })
    ).toBe(true);
  });

  test("should refuse a purchase of something that is not a plan", async () => {
    const { subscription } = createFakeSubscription();
    const onError = vi.fn();
    registerSubscriptionIpc({
      subscription,
      policy: createUrlPolicy(),
      onError,
    });
    await expect(
      invokeFrom(APP_PAGE, "subscription:purchase", { interval: "lifetime" })
    ).rejects.toThrow();
    expect(subscription.purchase).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("should refuse a page that is not the program's", async () => {
    const { subscription } = createFakeSubscription();
    registerSubscriptionIpc({ subscription, policy: createUrlPolicy() });
    await expect(
      invokeFrom("https://evil.example/", "subscription:manage")
    ).rejects.toThrow();
    expect(subscription.manage).not.toHaveBeenCalled();
  });

  test("should tell every window of the program about every change", () => {
    const { subscription, publish } = createFakeSubscription();
    const page = createPage(APP_PAGE);
    const stranger = createPage("https://example.com/");
    electron.webContents.getAllWebContents.mockReturnValue([page, stranger]);
    registerSubscriptionIpc({ subscription, policy: createUrlPolicy() });
    publish(TRIAL);
    expect(page.send).toHaveBeenCalledExactlyOnceWith(
      "subscription:state-changed",
      TRIAL
    );
    expect(stranger.send).not.toHaveBeenCalled();
  });

  test("should undo both the handlers and the broadcast", () => {
    const { subscription, publish, listenerCount } = createFakeSubscription();
    const page = createPage(APP_PAGE);
    electron.webContents.getAllWebContents.mockReturnValue([page]);
    const unregister = registerSubscriptionIpc({
      subscription,
      policy: createUrlPolicy(),
    });
    unregister();
    publish(TRIAL);
    expect(listeners.size).toBe(0);
    expect(listenerCount()).toBe(0);
    expect(page.send).not.toHaveBeenCalled();
  });
});
