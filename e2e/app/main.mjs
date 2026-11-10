import * as authShared from "@handijit/auth";
import * as authMain from "@handijit/auth/main";
import { channelsOf, defineContract } from "@handijit/electron";
import { startApp } from "@handijit/electron/main";
import * as shared from "@handijit/subscription";
import * as main from "@handijit/subscription/main";
import { z } from "zod";

import run from "./scenario.cjs";

// The ES module build of the package, resolved through its "exports" map.
run({
  authShared,
  authMain,
  channelsOf,
  defineContract,
  startApp,
  shared,
  main,
  z,
});
