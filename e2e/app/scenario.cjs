"use strict";

// The main-process half of the real-Electron smoke test. It starts the fixture program with
// the built package and the real @handijit/auth, drives the page and writes one JSON file with
// every check it made. scripts/electron-smoke.mjs spawns it, plays the backend, the browser
// and the payment, and reads that file.

const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const { app } = require("electron");

const DIRECTORY = process.env.SMOKE_DIR;
const OUT = process.env.SMOKE_OUT;
const PHASE = process.env.SMOKE_PHASE;
const API_URL = process.env.SMOKE_API_URL;
const CONTROL_URL = process.env.SMOKE_CONTROL_URL;
const KEY = JSON.parse(process.env.SMOKE_LICENSE_KEY);
const PROFILE = process.env.SMOKE_PROFILE;
const DEVICE_ID = process.env.SMOKE_DEVICE_ID || undefined;

const SUBSCRIPTION_PAGE = "https://www.handijit.com/panel/hesabim/abonelik";

// Each launch keeps its program data in the run's folder: one profile is the customer's
// computer across restarts, another one a second computer.
app.setPath("userData", join(DIRECTORY, PROFILE));

const checks = [];
const check = (name, ok, detail) => {
  checks.push({
    name,
    ok: ok === true,
    detail: ok === true ? undefined : detail,
  });
};
const same = (name, actual, expected) =>
  check(name, isDeepStrictEqual(actual, expected), actual);

const within = (promise, label, milliseconds = 20_000) =>
  Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        milliseconds
      ).unref();
    }),
  ]);
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const until = async (predicate, label) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await predicate()) return true;
    await sleep(50);
  }
  check(label, false, "the condition never became true");
  return false;
};

// The runner: it is the backend, the browser and the payment of this test.
const control = async (path, body) => {
  const response = await fetch(`${CONTROL_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.status === 204 ? undefined : response.json();
};

const scenario = async ({
  authShared,
  authMain,
  channelsOf,
  defineContract,
  startApp,
  shared,
  main,
  z,
}) => {
  const contract = defineContract({
    invoke: {
      ...authShared.authContract.invoke,
      ...main.subscriptionContract.invoke,
      "app:info": { output: z.object({ electron: z.string() }) },
    },
    events: {
      ...authShared.authContract.events,
      ...main.subscriptionContract.events,
    },
  });
  same(
    "contract: the Zod-free channel list of the preload equals the composed contract",
    channelsOf(contract),
    shared.withSubscriptionChannels({
      invoke: { ...authShared.AUTH_CHANNELS.invoke, "app:info": true },
      events: { ...authShared.AUTH_CHANNELS.events },
    })
  );

  // The addresses the program asked to open go to the runner instead of the system browser.
  let browserAction = "ignore";
  const pages = [];
  const logged = [];
  const logger = {
    info: (message, details) => logged.push({ message, details }),
    warn: (message, details) => logged.push({ message, details }),
  };
  const auth = authMain.createAuth({
    product: "notlar",
    apiBaseUrl: API_URL,
    openBrowser: async (url) => {
      await control("/browser", { url, action: browserAction });
    },
    logger,
  });
  const subscription = main.createSubscription({
    product: "notlar",
    auth,
    keys: [KEY],
    appVersion: "1.4.0",
    deviceName: "Smoke-PC",
    ...(DEVICE_ID === undefined ? {} : { deviceId: DEVICE_ID }),
    openExternal: async (url) => {
      pages.push(url);
      return true;
    },
    logger,
  });

  let started;
  const context = await startApp({
    contract,
    handlers: () => ({
      ...auth.handlers,
      ...main.createSubscriptionHandlers(subscription),
      "app:info": () => ({ electron: process.versions.electron }),
    }),
    rendererRoot: join(OUT, "renderer"),
    window: { preload: join(OUT, "preload.cjs"), width: 900, height: 720 },
    log: { level: "debug", mirrorToConsole: false },
    beforeWindow: (appContext) => {
      auth.attach(appContext);
      subscription.onChange((state) => {
        appContext.emitter.broadcast("subscription:state-changed", state);
      });
      started = subscription.start();
    },
  });

  const page = context.getWindow().webContents;
  const evaluate = (code) =>
    within(page.executeJavaScript(code, true), `page: ${code.slice(0, 60)}`);
  if (page.isLoading()) {
    await within(
      new Promise((resolve) => page.once("did-finish-load", resolve)),
      "the first page load"
    );
  }
  const smoke = (call) => evaluate(`window.__smoke.${call}`);
  const statusIs = (status) => subscription.getState().status === status;
  const waitFor = (status) =>
    until(
      async () =>
        statusIs(status) && (await smoke("state()"))?.status === status,
      `the state becomes ${status} in main and on the page`
    );
  const secretOf = (name) =>
    join(app.getPath("userData"), `secrets/${name}.bin`);
  const stats = () => control("/stats");

  // start() waits for the stored license, never for the network: a first start is still
  // loading when it resolves, a later one has decided.
  const first = await within(started, "the subscription's start");
  const isFirstStart = PHASE === "trial" || PHASE === "other-device";
  check(
    isFirstStart
      ? "start: with nothing stored, start() resolves before the backend answered"
      : "start: with a license stored, start() resolves with the decision",
    isFirstStart ? first.status === "loading" : first.status !== "loading",
    first.status
  );

  if (PHASE === "trial") {
    // 1. A computer that never ran the program: the backend starts its trial.
    await waitFor("trial");
    const state = subscription.getState();
    check(
      "trial: the trial ends in seven days and the license in three",
      Math.abs(state.trialEndsAt - Date.now() - 7 * 86_400_000) < 60_000 &&
        Math.abs(state.licenseExpiresAt - Date.now() - 72 * 3_600_000) < 60_000,
      state
    );
    same(
      "trial: the plan's limits come from the verified license",
      state.limits,
      {
        notes: 100,
      }
    );
    same(
      "page: the bridge exposes the program's, the sign-in's and the subscription's channels",
      (await smoke("bridge()")).invoke.filter(
        (name) => name.startsWith("subscription:") || name.startsWith("auth:")
      ),
      [
        ...Object.keys(authShared.AUTH_CHANNELS.invoke),
        ...Object.keys(shared.SUBSCRIPTION_CHANNELS.invoke),
      ].sort()
    );
    same("page: no Node in the page", await smoke("hasNode"), false);
    same(
      "page: the program is not covered during the trial",
      await smoke("isCovered()"),
      false
    );
    const banner = await smoke("banner()");
    check(
      "page: the banner counts the trial's days and offers to subscribe",
      typeof banner === "string" &&
        banner.startsWith("Deneme sürümü: 7 gün kaldı.") &&
        banner.endsWith("Abone ol"),
      banner
    );
    check(
      "page: the status block names the trial and its end",
      /^Deneme sürümü\n/.test(await smoke("status()")),
      await smoke("status()")
    );
    same(
      "main: check allows what the plan allows",
      subscription.check("notes", 99),
      {
        isAllowed: true,
      }
    );
    let refusal = null;
    try {
      subscription.require("notes", 100);
    } catch (error) {
      refusal = { name: error.name, code: error.code, max: error.max };
    }
    same("main: require refuses use beyond the plan's limit", refusal, {
      name: "SubscriptionAccessError",
      code: "LIMIT_REACHED",
      max: 100,
    });
    const record = existsSync(secretOf("subscription-license"))
      ? readFileSync(secretOf("subscription-license"), "latin1")
      : null;
    check(
      "disk: the license is stored encrypted by the operating system",
      record !== null && !record.includes("license") && !record.includes("eyJ"),
      record === null ? "missing" : "plain text"
    );
    check(
      "disk: the device id is stored encrypted",
      existsSync(secretOf("subscription-device")) &&
        !readFileSync(secretOf("subscription-device"), "latin1").includes(
          (await stats()).deviceIds[0] ?? "-"
        )
    );
    check(
      "plans: the plans are read for the paywall during the trial",
      (await smoke("state()")).plans.status === "ready"
    );

    // 2. The trial runs out at the backend; the program learns it at its next renewal.
    await control("/end-trial", {});
    // Renewals closer together than two seconds are folded into one: wait that out.
    await sleep(2100);
    await subscription.refresh();
    await waitFor("trial-expired");
    const gate = await smoke("gate()");
    same(
      "gate: the paywall covers the program",
      gate?.title,
      "Deneme süreniz doldu"
    );
    same(
      "gate: the program behind it is inert",
      await smoke("isProgramInert()"),
      true
    );
    check(
      "gate: both plans are offered at the backend's prices",
      gate !== null &&
        gate.text.includes("₺149,90") &&
        gate.text.includes("₺1.499") &&
        gate.text.includes("%16 daha uygun"),
      gate?.text
    );
    same(
      "gate: what can be pressed is buying a plan and signing in",
      await smoke("buttons()"),
      ["Aylık abone ol", "Yıllık abone ol", "Giriş yap"]
    );
    same(
      "main: nothing is allowed once the trial is over",
      subscription.check(),
      {
        isAllowed: false,
        reason: "not-entitled",
        limit: null,
        max: null,
      }
    );

    // 3. "Buy yearly": the subscription page opens in the browser and the program waits.
    same(
      "gate: the yearly button is there",
      await smoke('click("Yıllık abone ol")'),
      true
    );
    await until(() => pages.length === 1, "purchase: the page is opened");
    same(
      "purchase: the browser opens the subscription page for the plan",
      pages[0],
      `${SUBSCRIPTION_PAGE}?product=notlar&interval=yearly`
    );
    await until(
      async () => (await smoke("gate()"))?.text.includes("Ödeme bekleniyor"),
      "purchase: the gate says the payment is awaited"
    );
    check(
      "purchase: a signed-out buyer is asked to sign in after paying",
      (await smoke("gate()")).text.includes("aynı hesapla giriş yapın")
    );
  }

  if (PHASE === "subscribe") {
    // 4. The next start knows the trial is over before the backend says it again.
    await waitFor("trial-expired");
    same(
      "start: the page went from nothing straight to the paywall",
      (await smoke("statuses")).filter((status) => status !== "loading"),
      ["trial-expired"]
    );
    // The customer pays on the web site (the runner plays the checkout) and signs in here.
    await control("/subscribe", { userId: 41, plan: "yearly" });
    same(
      "gate: the yearly button is there",
      await smoke('click("Yıllık abone ol")'),
      true
    );
    await until(
      () => subscription.getState().purchase !== null,
      "purchase: waiting"
    );
    browserAction = "approve";
    same(
      "gate: the sign-in button is there",
      await smoke('click("Giriş yap")'),
      true
    );
    await waitFor("subscribed");
    const state = subscription.getState();
    same("subscribe: the yearly plan is in force", state.plan, "yearly");
    same("subscribe: the pending purchase is over", state.purchase, null);
    same("subscribe: the customer is signed in", state.isSignedIn, true);
    await until(
      async () => !(await smoke("isCovered()")),
      "page: the gate opens"
    );
    same(
      "page: the program is usable again",
      await smoke("isProgramInert()"),
      false
    );
    same("page: the trial banner is gone", await smoke("banner()"), null);
    check(
      "page: the status block names the plan",
      /^Yıllık abonelik\n/.test(await smoke("status()")),
      await smoke("status()")
    );
    same(
      "main: check allows the subscriber",
      subscription.check("notes", 10_000),
      {
        isAllowed: true,
      }
    );
    const backend = await stats();
    check(
      "backend: the paid license was asked for with the customer's session",
      backend.paidWithSession >= 1 && backend.paidWithoutSession === 0,
      backend
    );
    same(
      "backend: the subscription is bound to this computer, by the name it gave",
      backend.boundDevice,
      { name: "Smoke-PC", sameAsTrial: true }
    );
  }

  if (PHASE === "offline") {
    // 5. A restart without any network: the stored paid license carries the program.
    await waitFor("subscribed");
    same(
      "offline: the page never showed anything but the subscription",
      (await smoke("statuses")).filter((status) => status !== "loading"),
      ["subscribed"]
    );
    await until(
      () => subscription.getState().isOffline,
      "offline: the renewal failed"
    );
    const state = subscription.getState();
    same("offline: the yearly plan is still in force", state.plan, "yearly");
    check(
      "offline: until the stored license's own expiry, not beyond",
      state.licenseExpiresAt > Date.now() &&
        state.licenseExpiresAt <= Date.now() + 72 * 3_600_000,
      state.licenseExpiresAt
    );
    same(
      "offline: the program is not covered",
      await smoke("isCovered()"),
      false
    );
    same("offline: main still allows work", subscription.isEntitled(), true);
    check(
      "offline: the status block says it is offline",
      (await smoke("status()")).includes("Çevrimdışı"),
      await smoke("status()")
    );
    same(
      "offline: the sign-in survives too",
      auth.getState().status,
      "signed-in"
    );
  }

  if (PHASE === "other-device") {
    // 6. The same customer on a second computer whose trial is long over.
    await waitFor("trial-expired");
    browserAction = "approve";
    same(
      "gate: the sign-in button is there",
      await smoke('click("Giriş yap")'),
      true
    );
    await waitFor("device-mismatch");
    const gate = await smoke("gate()");
    same(
      "mismatch: the paywall says where the subscription is",
      gate?.title,
      "Abonelik başka bir cihaza bağlı"
    );
    check(
      "mismatch: it names the bound computer and its system",
      gate?.text.includes("Smoke-PC ("),
      gate?.text
    );
    same(
      "mismatch: what can be pressed is freeing the device on the web and retrying",
      await smoke("buttons()"),
      ["Panelde cihazı değiştir", "Yeniden dene"]
    );
    await smoke('click("Panelde cihazı değiştir")');
    await until(() => pages.length === 1, "mismatch: the panel is opened");
    same(
      "mismatch: the panel's subscription page opens",
      pages[0],
      `${SUBSCRIPTION_PAGE}?product=notlar`
    );
  }

  const written = JSON.stringify(logged);
  check(
    "logs: no license, token or device id is written to the log",
    !/eyJ|Bearer|accessToken|refreshToken/.test(written) &&
      ((await stats()).deviceIds ?? []).every((id) => !written.includes(id)),
    logged
  );

  writeFileSync(
    join(DIRECTORY, "result.json"),
    JSON.stringify({
      checks,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform}-${process.arch}`,
    })
  );
  subscription.dispose();
  app.quit();
};

module.exports = (modules) => {
  scenario(modules).catch((error) => {
    check("the scenario ran to its end", false, String(error?.stack ?? error));
    writeFileSync(join(DIRECTORY, "result.json"), JSON.stringify({ checks }));
    app.exit(1);
  });
};
