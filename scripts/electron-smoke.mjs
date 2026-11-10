// Launches a real Electron with the fixture program in e2e/app, the built package and the real
// @handijit/auth, four times against a local stand-in of the backend:
//
//   1. trial (ES module build): a new computer gets a trial license, the trial runs out, the
//      paywall covers the program and "buy yearly" opens the subscription page;
//   2. subscribe (CommonJS build), same computer: the paywall is there from the start, the
//      customer pays (played here) and signs in through the browser, the paid license arrives
//      and the paywall opens;
//   3. offline (ES module build), same computer, no network at all: the stored paid license
//      carries the program;
//   4. other device (ES module build), a second computer of the same customer: the paywall
//      names the computer the subscription is bound to.
//
//   npm run build && npm run test:electron
//
// This script is the backend, the browser and the checkout. The unit tests mock `electron`;
// this is the proof that the real one (safeStorage, IPC, the sandboxed preload, the page)
// behaves as they assume. Nothing here talks to a real backend or a payment service.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { nodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { build } from "vite";

// The backend of this test. Node runs the TypeScript file as it is (type stripping).
import startFakeApi from "../__tests__/support/fake-api.mts";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");
const APP = join(ROOT, "e2e/app");
const OUT = join(ROOT, "e2e/out");
const TIMEOUT_MS = 120_000;
const CUSTOMER = { id: 41, email: "ayse@example.com", name: "Ayşe Yılmaz" };
const PAID_PATH = "/api/customer/licenses";
// A second computer's device id: the first one's is derived from the machine.
const OTHER_DEVICE_ID = "smoke-second-computer-0123456789abcdef";

if (!existsSync(join(ROOT, "build/main.mjs"))) {
  console.error('electron-smoke: build/ is missing; run "npm run build" first');
  process.exit(1);
}

// `require("electron")` in Node is the path of the binary. It throws when the binary was not
// downloaded, which is the case after `npm ci --ignore-scripts`.
let electronBinary;
try {
  electronBinary = require("electron");
} catch {
  console.error(
    'electron-smoke: the Electron binary is missing; run "node node_modules/electron/install.js" first'
  );
  process.exit(1);
}

// The fixture is bundled the way a program bundles it: the preload into one CommonJS file
// (a sandboxed preload cannot load a second file), the page by Vite. Both import the package
// by its published names, which point at build/.
rmSync(join(OUT, "preload.cjs"), { force: true });
rmSync(join(OUT, "renderer"), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const preloadBundle = await rollup({
  input: join(APP, "preload.mjs"),
  external: ["electron"],
  plugins: [nodeResolve({ browser: true })],
});
await preloadBundle.write({ file: join(OUT, "preload.cjs"), format: "cjs" });
await preloadBundle.close();

await build({
  root: APP,
  base: "./",
  configFile: false,
  logLevel: "error",
  resolve: {
    alias: [
      {
        find: /^@handijit\/subscription\/styles\.css$/,
        replacement: join(ROOT, "build/styles.css"),
      },
      {
        find: /^@handijit\/subscription\/(renderer|react|ui)$/,
        replacement: join(ROOT, "build/$1.mjs"),
      },
    ],
  },
  build: { outDir: join(OUT, "renderer"), emptyOutDir: true },
});

// What a program's bundles may import, measured on the fixture's own output.
const preloadSource = readFileSync(join(OUT, "preload.cjs"), "utf8");
const preloadImports = [
  ...preloadSource.matchAll(/require\(['"]([^'"]+)['"]\)/g),
].map(([, name]) => name);
const bundleChecks = [
  {
    name: "the bundled preload requires electron and nothing else",
    ok: preloadImports.every((name) => name === "electron"),
    detail: preloadImports,
  },
  {
    name: "the bundled preload carries no Zod",
    ok: !/ZodType|safeParse/.test(preloadSource),
  },
];

const api = await startFakeApi();

// What the "browser" saw, as checks of the launch it happened in.
let browserChecks = [];
const browserCheck = (name, ok, detail) => {
  browserChecks.push({ name, ok: ok === true, detail });
};

// The consent page and the browser, for one sign-in address the program asked to open.
const playBrowser = async (address) => {
  const url = new URL(address);
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const code = api.authorize({ user: CUSTOMER, codeChallenge, redirectUri });
  const callback = await fetch(
    `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { redirect: "manual" }
  );
  browserCheck(
    "browser: the sign-in went through the program's loopback callback",
    callback.status === 303,
    callback.status
  );
};

// The program hands this server the addresses it would open; the runner reports what the
// backend saw. No license and no token ever goes this way.
let pendingBrowser = Promise.resolve();
const controlServer = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const path = new URL(request.url, "http://localhost").pathname;
    const body =
      chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString());
    if (path === "/browser") {
      response.writeHead(204).end();
      if (body.action === "approve") {
        pendingBrowser = playBrowser(body.url).catch((error) => {
          browserCheck(
            "browser: the visit ran to its end",
            false,
            String(error)
          );
        });
      }
      return;
    }
    if (path === "/end-trial") {
      api.endTrials();
      response.writeHead(204).end();
      return;
    }
    if (path === "/subscribe") {
      api.subscribe(body.userId, body.plan);
      response.writeHead(204).end();
      return;
    }
    const paid = api.requests.filter((entry) => entry.path === PAID_PATH);
    const bound = api.subscriptions.get(CUSTOMER.id)?.boundDevice ?? null;
    const [trialDevice] = api.trials.keys();
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        deviceIds: [...api.trials.keys()],
        paidWithSession: paid.filter((entry) =>
          entry.authorization?.startsWith("Bearer ")
        ).length,
        paidWithoutSession: paid.filter(
          (entry) => entry.authorization === undefined
        ).length,
        boundDevice:
          bound === null
            ? null
            : { name: bound.name, sameAsTrial: bound.id === trialDevice },
      })
    );
  });
});
await new Promise((done) => controlServer.listen(0, "127.0.0.1", done));
const controlUrl = `http://127.0.0.1:${controlServer.address().port}`;

const directory = mkdtempSync(join(tmpdir(), "handijit-subscription-smoke-"));

const launch = async ({
  name,
  entry,
  phase,
  profile,
  deviceId = "",
  after,
}) => {
  browserChecks = [];
  const resultFile = join(directory, "result.json");
  rmSync(resultFile, { force: true });

  const environment = {
    ...process.env,
    SMOKE_DIR: directory,
    SMOKE_OUT: OUT,
    SMOKE_PHASE: phase,
    SMOKE_PROFILE: profile,
    SMOKE_DEVICE_ID: deviceId,
    SMOKE_API_URL: api.url,
    SMOKE_CONTROL_URL: controlUrl,
    SMOKE_LICENSE_KEY: JSON.stringify(api.key),
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_RENDERER_URL;

  const child = spawn(electronBinary, [join(APP, entry)], {
    cwd: ROOT,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const exit = await new Promise((done) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ code: null, timedOut: true });
    }, TIMEOUT_MS);
    child.once("exit", (code) => {
      clearTimeout(timer);
      done({ code, timedOut: false });
    });
  });
  await pendingBrowser;

  const result = existsSync(resultFile)
    ? JSON.parse(readFileSync(resultFile, "utf8"))
    : { checks: [] };
  const checks = [...result.checks, ...browserChecks, ...after()];
  checks.push({
    name: "the program wrote its result and quit normally",
    ok: existsSync(resultFile) && exit.code === 0,
    detail: exit.timedOut
      ? `killed after ${TIMEOUT_MS} ms`
      : `exit code ${exit.code}`,
  });

  const failed = checks.filter(({ ok }) => !ok);
  for (const { name: label, ok, detail } of checks) {
    console.log(`${ok ? "ok  " : "FAIL"} [${name}] ${label}`);
    if (!ok) console.log(`       ${JSON.stringify(detail)}`);
  }
  if (failed.length > 0) console.log(`--- output of [${name}] ---\n${output}`);
  return { ...result, total: checks.length, failed: failed.length };
};

const runs = [];
try {
  let answeredBefore = 0;
  runs.push(
    await launch({
      name: "trial, esm",
      entry: "main.mjs",
      phase: "trial",
      profile: "computer-1",
      after: () => [
        {
          name: "backend: one device id asked for a trial",
          ok: api.trials.size === 1,
          detail: [...api.trials.keys()],
        },
      ],
    })
  );
  runs.push(
    await launch({
      name: "subscribe, cjs",
      entry: "main.cjs",
      phase: "subscribe",
      profile: "computer-1",
      after: () => [
        {
          name: "backend: the restart kept the device id (no second trial)",
          ok: api.trials.size === 1,
          detail: [...api.trials.keys()],
        },
      ],
    })
  );

  api.setOffline(true);
  answeredBefore = api.requests.filter((entry) => entry.isAnswered).length;
  const requestsBefore = api.requests.length;
  runs.push(
    await launch({
      name: "offline restart, esm",
      entry: "main.mjs",
      phase: "offline",
      profile: "computer-1",
      after: () => [
        {
          name: "backend: the program tried to renew, and nothing was answered",
          ok:
            api.requests.length > requestsBefore &&
            api.requests.filter((entry) => entry.isAnswered).length ===
              answeredBefore,
          detail: api.requests.length - requestsBefore,
        },
      ],
    })
  );
  api.setOffline(false);

  api.expireTrial(OTHER_DEVICE_ID);
  runs.push(
    await launch({
      name: "second computer, esm",
      entry: "main.mjs",
      phase: "other-device",
      profile: "computer-2",
      deviceId: OTHER_DEVICE_ID,
      after: () => [
        {
          name: "backend: the subscription stayed bound to the first computer",
          ok:
            api.subscriptions.get(CUSTOMER.id)?.boundDevice?.id ===
            [...api.trials.keys()][0],
        },
      ],
    })
  );
} finally {
  controlServer.close();
  await api.close();
  rmSync(directory, { recursive: true, force: true });
}

for (const { name, ok, detail } of bundleChecks) {
  console.log(`${ok ? "ok  " : "FAIL"} [bundle] ${name}`);
  if (!ok) console.log(`       ${JSON.stringify(detail)}`);
}
const total =
  runs.reduce((sum, run) => sum + run.total, 0) + bundleChecks.length;
const failed =
  runs.reduce((sum, run) => sum + run.failed, 0) +
  bundleChecks.filter(({ ok }) => !ok).length;
const [{ electron, chrome, node, platform }] = runs;

if (failed > 0) {
  console.error(`electron-smoke: ${failed} of ${total} checks FAILED`);
  process.exit(1);
}
console.log(
  `electron-smoke: ${total} checks passed in ${runs.length} launches on Electron ${electron} (Chromium ${chrome}, Node ${node}, ${platform})`
);
