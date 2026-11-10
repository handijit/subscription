import { execFile } from "node:child_process";
import type * as ChildProcess from "node:child_process";
import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import resolveDeviceId, {
  DEVICE_ID_PATTERN,
  DEVICE_SECRET,
  readMachineId,
} from "../../lib/main/device-id";
import { createMemoryStore } from "./subscription.fixture";

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcess>();
  return { ...real, execFile: vi.fn(real.execFile) };
});

const MAC_UUID = "0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
const IOREG_OUTPUT = `+-o Mac  <class IOPlatformExpertDevice>\n    {\n      "IOPlatformSerialNumber" = "C02XXXX"\n      "IOPlatformUUID" = "${MAC_UUID}"\n    }\n`;
const WINDOWS_GUID = "9f3c2a1e-1111-2222-3333-444455556666";
const REG_OUTPUT = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${WINDOWS_GUID}\r\n\r\n`;

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe("readMachineId", () => {
  test("should read the IOPlatformUUID on macOS with an absolute path", async () => {
    const run = vi.fn(() => Promise.resolve(IOREG_OUTPUT));
    expect(await readMachineId("darwin", run)).toBe(MAC_UUID.toLowerCase());
    expect(run).toHaveBeenCalledWith("/usr/sbin/ioreg", [
      "-rd1",
      "-c",
      "IOPlatformExpertDevice",
    ]);
  });

  test("should read the MachineGuid on Windows from the system folder", async () => {
    vi.stubEnv("SystemRoot", "D:\\Win");
    const run = vi.fn(() => Promise.resolve(REG_OUTPUT));
    expect(await readMachineId("win32", run)).toBe(WINDOWS_GUID);
    const [file, args] = run.mock.calls[0] as unknown as [string, string[]];
    expect(file).toMatch(/^D:\\Win.System32.reg\.exe$/);
    expect(args).toEqual([
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
    ]);
  });

  test("should fall back to C:\\Windows without SystemRoot", async () => {
    vi.stubEnv("SystemRoot", undefined);
    const run = vi.fn(() => Promise.resolve(REG_OUTPUT));
    await readMachineId("win32", run);
    expect((run.mock.calls[0] as unknown as [string])[0]).toMatch(
      /^C:\\Windows/
    );
  });

  test("should answer null for output it does not understand", async () => {
    const run = vi.fn(() => Promise.resolve("nothing here"));
    expect(await readMachineId("darwin", run)).toBeNull();
    expect(await readMachineId("win32", run)).toBeNull();
  });

  test("should answer null when the command fails or the platform has none", async () => {
    const run = vi.fn(() => Promise.reject(new Error("denied")));
    expect(await readMachineId("darwin", run)).toBeNull();
    expect(await readMachineId("linux", run)).toBeNull();
  });

  test("should run the real command of this machine", async () => {
    const id = await readMachineId(process.platform);
    if (process.platform === "darwin" || process.platform === "win32") {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    } else {
      expect(id).toBeNull();
    }
  });

  test("should hand the command's output over when it succeeds", async () => {
    vi.mocked(execFile).mockImplementationOnce(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      callback(null, IOREG_OUTPUT);
    }) as never);
    expect(await readMachineId("darwin")).toBe(MAC_UUID.toLowerCase());
  });

  test("should answer null when the command cannot be started", async () => {
    vi.mocked(execFile).mockImplementationOnce(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      callback(
        Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
        ""
      );
    }) as never);
    expect(await readMachineId("darwin")).toBeNull();
  });
});

describe("resolveDeviceId", () => {
  test("should keep the stored device id", async () => {
    const stored = "x".repeat(43);
    const { store } = createMemoryStore({ [DEVICE_SECRET]: stored });
    const run = vi.fn();
    expect(
      await resolveDeviceId({
        product: "notlar",
        platform: "darwin",
        store,
        logger: logger(),
        run,
      })
    ).toBe(stored);
    expect(run).not.toHaveBeenCalled();
  });

  test("should derive the id from the machine and the product, and store it", async () => {
    const { store } = createMemoryStore();
    const run = vi.fn(() => Promise.resolve(IOREG_OUTPUT));
    const id = await resolveDeviceId({
      product: "notlar",
      platform: "darwin",
      store,
      logger: logger(),
      run,
    });
    expect(id).toBe(
      createHash("sha256")
        .update(`handijit-device:notlar:${MAC_UUID.toLowerCase()}`)
        .digest("base64url")
    );
    expect(id).toMatch(DEVICE_ID_PATTERN);
    expect(store.set).toHaveBeenCalledWith(DEVICE_SECRET, id);
    // A reinstall finds the same id; another product gets another one.
    const again = await resolveDeviceId({
      product: "notlar",
      platform: "darwin",
      store: createMemoryStore().store,
      logger: logger(),
      run,
    });
    expect(again).toBe(id);
    const other = await resolveDeviceId({
      product: "on-muhasebe",
      platform: "darwin",
      store: createMemoryStore().store,
      logger: logger(),
      run,
    });
    expect(other).not.toBe(id);
  });

  test("should replace a stored id the backend would reject", async () => {
    const { store } = createMemoryStore({ [DEVICE_SECRET]: "short" });
    const run = vi.fn(() => Promise.resolve(REG_OUTPUT));
    const id = await resolveDeviceId({
      product: "notlar",
      platform: "win32",
      store,
      logger: logger(),
      run,
    });
    expect(id).toMatch(DEVICE_ID_PATTERN);
  });

  test("should fall back to a random id and say so", async () => {
    const memory = createMemoryStore();
    memory.failWrites();
    const log = logger();
    const id = await resolveDeviceId({
      product: "notlar",
      platform: "linux",
      store: memory.store,
      logger: log,
    });
    expect(id).toMatch(DEVICE_ID_PATTERN);
    expect(log.warn).toHaveBeenCalledWith(
      "subscription: the machine id could not be read; the device id is random"
    );
    expect(log.warn).toHaveBeenCalledWith(
      "subscription: the device id could not be stored"
    );
  });

  test("should read a store that fails as no stored id", async () => {
    const { store } = createMemoryStore();
    vi.mocked(store.get).mockRejectedValueOnce(new Error("broken"));
    const id = await resolveDeviceId({
      product: "notlar",
      platform: "linux",
      store,
      logger: logger(),
    });
    expect(id).toMatch(DEVICE_ID_PATTERN);
  });
});
