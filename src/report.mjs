/** What one check found. `failures` fail the run; `warnings` and `info`
 * are printed and do not. Every line names a place as `path:line`. */
export function createReport(name) {
  return { name, failures: [], warnings: [], info: [], summary: "" };
}

export function fail(report, file, line, message) {
  report.failures.push(`${file}:${line}  ${message}`);
}

export function warn(report, file, line, message) {
  report.warnings.push(line ? `${file}:${line}  ${message}` : `${file}  ${message}`);
}

export function print(report, { verbose = false } = {}) {
  if (verbose) for (const line of report.info) console.log(`  ${line}`);
  for (const line of report.warnings) console.warn(`  warn  ${line}`);
  if (report.failures.length > 0) {
    console.error(`\ncheck:${report.name} -- ${report.failures.length} problem(s):`);
    for (const line of report.failures) console.error(`  ${line}`);
    return false;
  }
  console.log(`check:${report.name} -- OK (${report.summary})`);
  return true;
}
