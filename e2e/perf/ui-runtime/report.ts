/**
 * report.ts — SKY-8217 shared harness plumbing.
 *
 * Machine-readable result sink for the 4 UI-runtime perf metrics, matching
 * the JSON-baseline convention `plans/PERF_BASELINE.json` already uses for
 * the data-layer perf bench (electron-main/src/perfBudget.bench.ts) — a
 * timestamped file with one entry per metric, alongside (not merged into)
 * that file since the two benches measure different layers (UI runtime vs.
 * SQLite/FTS5 data operations) on different harnesses.
 *
 * This is a MEASUREMENT record, not a regression gate: each metric carries
 * its own `pass` bit (computed against the PERFORMANCE.md §0 target) purely
 * for the human-readable table and the close-out report. Nothing in this
 * repo fails a build because `pass` is false — see ui-runtime.spec.ts's
 * top-of-file note for why.
 */
import fs from 'fs';
import path from 'path';

export const REPORT_PATH = path.resolve(__dirname, '../../../plans/PERF_UI_RUNTIME_BASELINE.json');

export interface MetricResult {
  value: number;
  unit: string;
  target: number;
  targetDescription: string;
  pass: boolean;
  detail?: Record<string, unknown>;
}

export interface UiRuntimeReport {
  timestamp: string;
  build: string;
  metrics: Record<string, MetricResult>;
}

function readReport(): UiRuntimeReport {
  try {
    return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8')) as UiRuntimeReport;
  } catch {
    return { timestamp: '', build: 'packaged (electron-vite build, out/main/main.js)', metrics: {} };
  }
}

/**
 * Merges one metric's result into the on-disk report. Read-modify-write
 * rather than one-writer-per-run because ui-runtime.spec.ts's 4 metrics each
 * run in their own `test.describe` (separate Electron launches, since they
 * need different `--force-prefers-reduced-motion` settings) and each writes
 * its own slice independently. `--workers=1` (set on the
 * `test:e2e:perf-ui-runtime` script) keeps these writes sequential — this is
 * not safe to run with parallel workers.
 */
export function writeMetricResult(name: string, result: MetricResult): void {
  const report = readReport();
  report.timestamp = new Date().toISOString();
  report.metrics[name] = result;
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

function fmtStatus(pass: boolean): string {
  return pass ? 'PASS' : 'FAIL';
}

/** Prints the full human-readable table for whatever metrics are on disk so far. */
export function printReportTable(): void {
  const report = readReport();
  const rows = Object.entries(report.metrics);
  // eslint-disable-next-line no-console
  console.log('\n[SKY-8217 perf] UI-runtime harness report');
  // eslint-disable-next-line no-console
  console.log(`  build: ${report.build}`);
  for (const [name, m] of rows) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${fmtStatus(m.pass).padEnd(4)} ${name.padEnd(28)} ${m.value.toFixed(2)} ${m.unit} ` +
        `(target: ${m.targetDescription})`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`  full JSON: ${REPORT_PATH}\n`);
}
