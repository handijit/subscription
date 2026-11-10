import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

import type { SubscriptionLogger, SubscriptionSecretStore } from "./types";

/** The secret the device id is kept under. */
const DEVICE_SECRET = "subscription-device";

// What the backend accepts as a device id.
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const MACHINE_ID_TIMEOUT_MS = 5000;
const IOREG = "/usr/sbin/ioreg";
const MAC_UUID_PATTERN = /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/;
const WINDOWS_GUID_PATTERN = /MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]{36})/;

type RunFile = (file: string, args: readonly string[]) => Promise<string>;

// No shell, absolute paths, a time limit: nothing on PATH or in the environment can stand in.
const runFile: RunFile = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: MACHINE_ID_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error === null) resolve(stdout);
        else reject(error);
      }
    );
  });

/**
 * The operating system's own id of this machine: the IOPlatformUUID on macOS, the
 * MachineGuid on Windows. Both survive reinstalling the program. `null` when it cannot be read.
 */
const readMachineId = async (
  platform: string,
  run: RunFile = runFile
): Promise<string | null> => {
  try {
    if (platform === "darwin") {
      const output = await run(IOREG, ["-rd1", "-c", "IOPlatformExpertDevice"]);
      return MAC_UUID_PATTERN.exec(output)?.[1]?.toLowerCase() ?? null;
    }
    if (platform === "win32") {
      const windows = process.env.SystemRoot ?? "C:\\Windows";
      const output = await run(join(windows, "System32", "reg.exe"), [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
        "/v",
        "MachineGuid",
      ]);
      return WINDOWS_GUID_PATTERN.exec(output)?.[1]?.toLowerCase() ?? null;
    }
  } catch {
    // A locked-down machine may refuse; the caller falls back.
  }
  return null;
};

// The machine's id never leaves it as it is: what the backend sees is a hash bound to the product.
const deriveDeviceId = (machineId: string, product: string): string =>
  createHash("sha256")
    .update(`handijit-device:${product}:${machineId}`)
    .digest("base64url");

type ResolveDeviceIdOptions = {
  product: string;
  platform: string;
  store: SubscriptionSecretStore;
  logger: SubscriptionLogger;
  run?: RunFile;
};

/**
 * The installation's device id. The stored one wins, so it never changes once a license was
 * issued for it; without one it is derived from the machine (a reinstall finds the same id, so
 * a trial cannot be started again) and stored; only when the machine has no readable id is it
 * random.
 */
const resolveDeviceId = async ({
  product,
  platform,
  store,
  logger,
  run,
}: ResolveDeviceIdOptions): Promise<string> => {
  const stored = await store.get(DEVICE_SECRET).catch(() => null);
  if (stored !== null && DEVICE_ID_PATTERN.test(stored)) return stored;

  const machineId = await readMachineId(platform, run);
  const deviceId =
    machineId === null
      ? randomBytes(32).toString("base64url")
      : deriveDeviceId(machineId, product);
  if (machineId === null) {
    logger.warn(
      "subscription: the machine id could not be read; the device id is random"
    );
  }
  await store.set(DEVICE_SECRET, deviceId).catch(() => {
    logger.warn("subscription: the device id could not be stored");
  });
  return deviceId;
};

export type { ResolveDeviceIdOptions, RunFile };
export { DEVICE_ID_PATTERN, DEVICE_SECRET, readMachineId };
export default resolveDeviceId;
