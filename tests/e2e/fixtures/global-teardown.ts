import { assertNoCspViolationsThisRun } from './guards';

/**
 * The run-level half of the CSP guard (R18, R20).
 *
 * The per-test assertion in the `cspGuard` fixture is the primary signal and
 * reports at the point of failure, where it is most useful. It cannot cover one
 * case on its own: a test declared `test.fail()` inverts its result, so the
 * guard's throw becomes that test's expected failure and the run stays green.
 * This suite has such a test on purpose - the AE2 teardown proof - so the hole
 * is real rather than hypothetical.
 *
 * Violations are therefore also written to a run sink by the worker, and read
 * here in the runner, where nothing can invert them.
 */
export default function globalTeardown(): void {
  assertNoCspViolationsThisRun();
}
