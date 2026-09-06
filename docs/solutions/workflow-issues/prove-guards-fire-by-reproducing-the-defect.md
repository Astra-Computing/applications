---
title: A verification mechanism needs its own verification
date: 2026-09-06
category: workflow-issues
module: testing
problem_type: workflow_issue
component: testing_framework
severity: high
applies_when:
  - Adding a new automated guard, assertion, or standing check to a test suite
  - Porting assertions out of a deleted or replaced script into a new test file
  - Adding a scanner or lint step that verifies every spec uses a required guard or fixture
  - Relying on a shared fixture enforced across multiple spec files
  - Reviewing a suite that reported green while a shipped defect went undetected
tags: [fail-open-guards, test-verification, ported-assertions, csp-worker-src, test-match-glob, mutation-testing, playwright, vitest]
---

# A verification mechanism needs its own verification

## Context

This project's suites exist to stop one class of defect: the kind that leaves every signal green while the feature is dead.

The motivating case: the champion celebration never fired on any deployed build, across at least two releases. `canvas-confetti` renders through an OffscreenCanvas worker built from a `blob:` URL. `next.config.js` set no `worker-src`, so the CSP fell back to `script-src 'self' 'unsafe-inline'`, which does not permit `blob:`, and the browser blocked the worker. It fails silently by construction — `new Worker()` returns successfully and the block happens asynchronously, so the canvas is created, control is transferred to it, and nothing ever draws. Every DOM-level signal a naive check looks for (canvas present, sized, visible, correct z-index) was satisfied.

**The verification did not merely miss it — it certified the opposite.** A Playwright driver ran a full game to champion and reported 26 of 26 checks passing, and that pass was presented as release-readiness evidence for a version that then shipped broken. The defect was found by the user manually playing the deployed build: *"I don't see any of the fireworks on win."* No automated signal ever caught it, at any point. (session history)

Two dead ends came before the cause, and both are the shape you should expect (session history):

1. **Treated as a timing artifact.** The first re-probe found no canvas on the host while the slideshow was still up, which looked like a test-side wait problem. Re-probing with a proper wait showed both host and player *did* create a visible canvas — so the mechanism looked fine and attention moved on.
2. **Treated as a tuning problem.** A screenshot showed a canvas with effectively no visible particles, which was attributed to bad animation parameters — bursts anchored at the very bottom edge with fast decay, a shower spawning above the viewport at zero start velocity — and the parameters were rewritten. That did not hold up: switching to screenshots taken mid-burst, *the honest check anyway*, found **zero** particles at 350 ms into a 130-particle burst, which ruled tuning out and forced the real question.

The guards written in response are themselves code, and nothing about writing a guard makes it correct. Over the following feature's work on the test suite (PR #2 on `Astra-Computing/applications`, open and green as of writing; PR #1 landed the first three units), **six** separate mechanisms were found passing while the behaviour they existed to protect was broken or absent. That is what this doc records.

## Guidance

### 1. Mutation-test every guard: revert the behaviour, expect red

A test that has never been observed failing is a hypothesis, not a guard. Before trusting one, revert the behaviour it names — on a scratch copy, never the real checkout — and confirm the suite goes red.

```bash
docker exec dev-env sh -c 'rm -rf /tmp/uqm && mkdir -p /tmp/uqm && cd /workspace/projects/bracketapp-web \
  && tar cf - --exclude=node_modules --exclude=.next --exclude=.git . | (cd /tmp/uqm && tar xf -) \
  && ln -s /workspace/projects/bracketapp-web/node_modules /tmp/uqm/node_modules'
# then edit /tmp/uqm and:  cd /tmp/uqm && npx vitest run --project unit
```

`node_modules` is symlinked rather than copied so the copy costs seconds. The scratch copy is the whole discipline: mutating the real tree means a forgotten revert becomes a shipped regression, and the fear of that makes you reluctant to try the aggressive mutations that find the most.

The mutation must be a **revert of behaviour**, not a change of shape. Deleting a whole block, swapping a safe construct for the unsafe one it replaced, removing an early-return guard clause — those are the shapes a real regression takes.

### 2. Assert measured numbers, not described intent

Several holes were assertions phrased as descriptions. In `buildBracket`, the author interleave deliberately makes an author meet themselves early. `expect(clashes > 0)` *describes* that. It is also true with the interleave deleted, true with the BYE relocation deleted, and true under most mutations of either. Tightening it to `odd <= even` did not help. What holds the line is the exact count on a field where the count does not vary (`src/lib/gameLogic.test.ts:394-409`):

```ts
// Even fields: no BYE, and the count does not vary between builds.
expect(clashesIn(2, 12)).toBe(0);  // exactly two quotes: the one case that separates
expect(clashesIn(6, 8)).toBe(2);   // 3 without the interleave
expect(clashesIn(7, 7)).toBe(3);
```

The trailing comment on the `6, 8` line is the point: it records the number the mutation produces, so the next reader knows the assertion is load-bearing rather than incidental.

A related vacuous form from the same period: an `R30` check asserting `recap >= 0`, which is true of every integer. It passed silently while finding zero rows — and the UI element the requirement described did not exist on the screen being checked at all. (session history)

### 3. Build the fixture the mutation needs, or the test proves nothing

`playerNameForToken` must not resolve names through the prototype chain. The first test looked up `'toString'` in an **empty** object — but `Object.prototype.toString` is a function, never the string `'toString'`, so the lookup returns nothing under a safe implementation *and* an unsafe `for...in` one. It passed either way. The fix is a real inherited entry (`src/lib/gameLogic.test.ts:146-162`):

```ts
const inherited: Record<string, string> = Object.create({ Ghost: 'tok-inherited' });
inherited.Real = 'tok-real';
expect(playerNameForToken(s, 'tok-inherited')).toBeNull();
```

A selector that matches nothing is a green test forever. One retired driver counted `.results-wave` elements — a class that has never existed here: `results-wave` is the keyframe name (`src/app/globals.css:1049`, used at `src/app/globals.css:1041`) and the elements carry `.slide-wave` (`src/app/globals.css:1032`, `src/components/ResultsSlideshow.tsx:76-77`). The count was structurally always 0. It was caught only because someone finally *read* the drivers while retiring them, and was dropped rather than carried into the new suite — a near-miss that had been running green for months.

### 4. Match the runner's collection rules exactly, and cite the source

A scanner refuses any spec that imports `test` from `@playwright/test` and so escapes the auto-use CSP fixture. It filtered on `/\.spec\.[cm]?tsx?$/`. But `playwright.config.ts` sets `testDir` and **no** `testMatch`, so Playwright's own default applies — `**/*.@(spec|test).?(c|m)[jt]s?(x)`, in the installed runner at `node_modules/playwright/lib/common/index.js:639`. A spec named `.test.ts`, `.spec.js` or `.test.tsx` was collected and run with no CSP guard while the scanner reported success. Three of the four ordinary spec names were invisible to it (`tests/e2e/fixtures/guards.ts:466`):

```ts
const COLLECTED_BY_RUNNER = /\.(spec|test)\.[cm]?[jt]sx?$/;
```

Any guard that scans a file set must derive that set from the same rule the tool uses, and name in a comment where that rule lives so it can be rechecked when the config changes.

### 5. Give the guard its own self-test — it pays for itself immediately

The scanner had no test, which is exactly why its hole survived: nothing had ever fed it a file it was supposed to reject. It now has cases covering every filename the runner collects and every import shape that reaches the unguarded `test` (`tests/e2e/guards.spec.ts:105-118`).

On its **first** run that self-test caught a false positive in its own fix: the self-test lists each escaping shape as a string literal, and the widened, unanchored pattern read those literals as real imports and refused the run. The detector is now anchored to line starts, because a real import is a statement and a string literal is not (`tests/e2e/fixtures/guards.ts:482-488`). A guard that fails on the file documenting it is not a guard anybody keeps — and the self-test found that before anyone else had to.

### 6. Close the paths that invert or opt out of a verdict

Two holes were not about detection at all. The guard saw the violation and its verdict was neutralised downstream.

**Inversion.** The CSP guard throws in fixture teardown. Under a test declared `test.fail()`, that throw *becomes* the expected failure and the run stays green — and this suite has such a test on purpose, so the hole was live. The fix is a channel the inversion cannot reach: the worker writes violations to a run sink file (`tests/e2e/fixtures/guards.ts:100`) and the runner reads it in global teardown (`tests/e2e/fixtures/global-teardown.ts`), where nothing can invert it. A file rather than a module-level array, because the guard runs in a worker process and the teardown in the runner.

**Opt-out.** `acknowledge()` removes violations from the failing set; its comment said "for ONE caller" and nothing enforced it, so any spec could quietly exempt itself. The rule is now code (`tests/e2e/fixtures/guards.ts:216-230`):

```ts
const caller = testInfo()?.file ?? '';
if (path.basename(caller) !== 'guards.spec.ts') throw new Error(/* ... */);
```

A comment is documentation of a rule, never the rule.

### 7. Port the assertion, not just the file

A port moved two hand-written checkers into the Vitest suite, went green, and deleted the originals. Green was not evidence the coverage came with them: the `if (!playerToken)` 401 assertion for the vote and heartbeat routes had simply not arrived, and the join route was in no test at all. Deleting the guard clause from both routes left the entire suite green. Both are now asserted directly (`src/lib/gameLogic.test.ts:190-195`, `:200-204`).

Retiring an old checker is a diff between two lists of *claims*, not a file move. One of those checkers also stripped comments before asserting a header string was absent — and the first port matched the comments explaining the fix rather than the code. A check can pass for the wrong reason in both directions. (session history)

### 8. A guard proven against its own defect can still be bypassable

The plan that introduced these guards already required proving them by reproducing the defects they targeted, and that was done — the CSP guard was shown failing with `worker-src` removed, the staleness guard with a mismatched build. Both still shipped with holes, because **proving a guard fires for defect X is not the same as proving it cannot be bypassed.** Findings 4, 5 and 6 are all bypasses, not detection failures. Prove both properties.

The same distinction produced a real requirement here. A review noticed the plan's rule for when to run the browser layer said *"when the change touches the interface"* — and the fireworks bug was a CSP directive in `next.config.js`, not an interface change. Following the plan literally, nobody would ever have run the check that catches it. The rule now names CSP, `next.config.js`, build configuration and dependencies explicitly. **A guard is only as good as the trigger that runs it.** (session history)

## Why This Matters

A guard that fails open and reports success is strictly worse than no guard. It costs the same to write and run, and it additionally destroys the suspicion that would otherwise have found the bug. *"The CSP guard is green"* ends an investigation. *"There is no CSP guard"* starts one. Every one of the six holes had that shape: the mechanism ran, produced a pass, and the pass was meaningless.

The cost is measured in this project's own history — a celebration dead across two releases behind a driver reporting 26 of 26 checks passed, found by a person playing the game. The replacement asserts pixels rather than DOM: a strip of the canvas that is not pixel-for-pixel identical across captures spanning the burst, with a failure message that names `worker-src` so the next person does not re-derive the mechanism. The directive is *also* asserted without a browser, in the job that gates every pull request (`src/lib/securityHeaders.test.ts:40-43`, against `next.config.js:22`), because the browser layer is slow and deliberately not in CI — a guard nobody runs is a third way to fail open.

There is a second-order effect worth naming. Once mutation testing is routine, assertions get written differently from the start: measured numbers instead of inequalities, real fixtures instead of convenient ones, verdicts routed away from anything that can invert them. The practice improves the tests you have not written yet.

## When to Apply

Apply it whenever the thing being written is a *check* rather than a feature:

- **Any new guard, scanner, lint rule, CI gate, or assertion whose whole purpose is to fail.** Non-negotiable. If you cannot make it fail on demand, you do not know it works.
- **Any test ported, rewritten, or migrated from another harness.** Green after a port measures nothing.
- **Any assertion phrased as an inequality, an existence check, or a count against a selector.** `> 0`, `toBeDefined()`, `toHaveCount(1)`, `>= 0`, `not.toThrow()` — each is satisfiable by a broken implementation. Ask what a mutation would have to look like to break it; if the answer is "almost nothing", tighten it.
- **Any guard that scans, filters, or enumerates files, routes, or config keys.** The scan rule and the tool's real rule drift silently, and only in the direction of missing things.
- **Any escape hatch, acknowledgement, allowlist, or skip.** If a comment is what stops it being abused, it is not stopped.
- **Any check whose verdict passes through a wrapper that can invert or swallow it** — expected-failure tests, retries, `catch` blocks, soft assertions.
- **After a bug that every existing signal missed.** That is definitive evidence a mechanism failed open. Find out which one, and how.

Not worth the ceremony for a straightforward feature test that fails visibly during ordinary development, or for a check whose failure you have already witnessed for real.

## Examples

### A ported check that measured nothing

Before — passed under a prototype-unsafe `for...in`, because `Object.prototype.toString` is a function and never the string `'toString'`:

```ts
const empty = { playerTokens: {} } as unknown as GameState;
expect(playerNameForToken(empty, 'toString')).toBeNull();
```

After — a genuinely inherited entry, so the unsafe implementation resolves `'tok-inherited'` to `'Ghost'` and the test fails:

```ts
const inherited: Record<string, string> = Object.create({ Ghost: 'tok-inherited' });
inherited.Real = 'tok-real';
expect(playerNameForToken(s, 'tok-inherited')).toBeNull();
expect(playerNameForToken(s, 'tok-real')).toBe('Real');
```

### A guard whose file filter was narrower than the runner's

Before — skips `.test.ts`, `.spec.js` and `.test.tsx`, so a spec in any of them ran with no CSP guard while the scanner reported success:

```ts
if (!/\.spec\.[cm]?tsx?$/.test(entry.name)) continue;
```

After — the runner's own default, with the source cited in a comment above it. Proved end-to-end on a throwaway copy of the tree by creating a temporary spec named `sneaky.test.ts` under `tests/e2e/` (never committed, and absent from the repo by design): Playwright collected and ran it, the old scanner did not see it, the new one rejects it by name.

```ts
const COLLECTED_BY_RUNNER = /\.(spec|test)\.[cm]?[jt]sx?$/;
```

### A verdict a `test.fail()` could invert

Before — the only signal was a throw in fixture teardown, which an expected-failure test converts into its expected failure:

```ts
} finally {
  guard.assertNone();
}
```

After — record first, then throw, and re-check in the runner where nothing can invert the result:

```ts
recordToRunSink(this.seen);   // read again in globalTeardown
this.seen.length = 0;
throw new Error(/* names the directive */);
```

## Related

- `docs/plans/2026-09-05-0914-feat-test-architecture-plan.md` — the plan this work implemented, and the origin of the files cited above. Its `## Deviations` section is the historical record; its U6 execution note already required proving the guards by reproducing their defects, which finding 8 above extends.
