#!/usr/bin/env node
// Usage: frontend-checks <check...|all> [--verbose]
//
// Runs from the app root and reads its frontend-checks.config.mjs. Exits 1
// as soon as any of the named checks reports a problem (after running all
// of them, so one run shows everything).

import { CHECKS, loadConfig, print } from "../src/index.mjs";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const names = args.filter((arg) => !arg.startsWith("--"));
const selected = names.length === 0 || names.includes("all") ? Object.keys(CHECKS) : names;

const unknown = selected.filter((name) => !CHECKS[name]);
if (unknown.length > 0) {
  console.error(`Unknown check(s): ${unknown.join(", ")}. Available: ${Object.keys(CHECKS).join(", ")}, all`);
  process.exit(2);
}

const config = await loadConfig();
let ok = true;
for (const name of selected) {
  const report = await CHECKS[name](config);
  ok = print(report, { verbose }) && ok;
}
process.exit(ok ? 0 : 1);
