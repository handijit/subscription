"use strict";

const authShared = require("@handijit/auth");
const authMain = require("@handijit/auth/main");
const { channelsOf, defineContract } = require("@handijit/electron");
const { startApp } = require("@handijit/electron/main");
const shared = require("@handijit/subscription");
const main = require("@handijit/subscription/main");
const { z } = require("zod");

const run = require("./scenario.cjs");

// The CommonJS build of the package, resolved through its "exports" map.
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
