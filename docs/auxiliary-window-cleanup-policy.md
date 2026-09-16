# Auxiliary-Window Cleanup Policy

**Status:** Implemented for review on 2026-09-16. Issue #23 remains open.

This policy addresses test isolation for browsing contexts created by the
legacy target-window tests. It does not change Sammy behavior or adopt a
Firefox-specific workaround. Issue
[#21](https://github.com/jasonfigueroa/sammy/issues/21) established why the
leak is consequential in Firefox; issue
[#23](https://github.com/jasonfigueroa/sammy/issues/23) owns this policy.

## Current Behavior

Three tests in [`test/application_spec.js`](../test/application_spec.js)
exercise `Sammy.targetIsThisWindow()` through the bindings installed by
`Application.run()`:

| Test | Browser action and assertion | Auxiliary-page behavior | Cleanup |
| --- | --- | --- | --- |
| `ignores links that target other windows` | Triggers a click on an anchor with `target="another-window"`; asserts the Sammy route callback did not run. | An isolated Chrome 152 run created no extra page for this direct jQuery anchor click. | None beyond `app.unload()`. |
| `ignores links with contents that target other windows` | Triggers a click on a child `span`; verifies Sammy finds the closest targeted anchor and does not run the route. | The browser opened a named page at `/#/some/route`. | None beyond `app.unload()`. |
| `ignores forms that target other windows` | Submits a GET form with `target="foo"`; asserts the Sammy route callback did not run. | The browser opened a named page at `/?#/a/route`. | None beyond `app.unload()`. |

The source behavior is deliberate. The delegated link handler intercepts a
same-window route only when `Sammy.targetIsThisWindow()` returns true. The
submit handler likewise returns without calling `_checkFormSubmission()` for
a form targeting another window. jQuery then permits the browser's default
action where its synthetic-event behavior invokes one. The tests prove that
Sammy does not capture the targeted navigation; they do not inspect the
auxiliary document or require it to remain open after the test.

The historical root mapping makes the leak more significant than an idle
page. A target URL has `/` as its document path, so the auxiliary context
loads `test/index.html`, its dependencies, and its specs. It can begin another
unobserved Mocha run. Removing the link or form from `#main` and unloading the
Sammy application do not close that top-level context. The modern harness
keeps the shared browser context alive until the full suite finishes, so the
extra pages persist across tests and can take focus from the main page.

This is test-state leakage exposed through a harness that currently provides
only suite-level cleanup. The native navigation is intentional for the
originating test; its persistence into later tests is not an asserted Sammy
contract.

## Options Considered

| Option | Advantages | Risks and maintenance implications |
| --- | --- | --- |
| Per-test teardown | Most visibly associates cleanup with the three tests. | The tests do not receive reliable handles for native target navigations. Obtaining them would require restructuring the actions, opening windows in advance, or relying on known window names. That changes the legacy corpus and is easy to omit in future tests. |
| Shared in-page helper | Provides one isolation rule for all specs and can use Mocha hooks. | Page JavaScript cannot reliably enumerate native top-level contexts. It would need window-name knowledge or browser-API interception, hiding orchestration concerns inside the legacy page. |
| Harness-owned cleanup | The harness owns the fresh browser context, can identify every top-level page, and can preserve the specs unchanged. The rule applies consistently across browsers. | Puppeteer target discovery and page closure do not prevent the new document from executing concurrently. Instrumentation observed auxiliary `mocha.run()` calls before closure, so this option alone cannot guarantee runner isolation. |
| Suite-end cleanup only | Matches the current harness and has no per-test intervention. | It does not provide isolation and permits focus, timers, network activity, and duplicate unobserved test runs to affect later tests. |

## Pre-Implementation Boundary Validation

Temporary instrumentation recorded top-level page creation, cleanup calls,
and a server-side beacon from every actual `mocha.run()`. It established:

1. A next-test root `beforeEach` snapshot is not a race-free runner barrier.
   One target was reported while cleanup was in progress, and the form target
   was not closed until a later test boundary. No auxiliary runner happened
   to start in that run, but the ordering cannot prove that one cannot start.
2. A root `afterEach` is not a stronger complete-teardown boundary in Mocha
   1.0.1. The runner calls `hookUp('afterEach')`, whose suite traversal runs
   the root hook before the nested suite's hook. Instrumentation also observed
   the `another-window` page emit its runner-start beacon before root
   `afterEach` cleanup closed it.
3. Closing pages immediately from Puppeteer's `targetcreated` event is still
   not a runner guard. Two instrumented runs saw only the main runner, but a
   third saw both `another-window` and `foo` emit runner-start beacons before
   their close operations completed.

All temporary instrumentation was removed. These results reject the original
harness-only proposal under the requirement that no auxiliary runner may
begin before cleanup.

## Adopted Policy

The harness owns page cleanup, and cleanup is paired with a
small runner-admission guard. Puppeteer page discovery alone cannot provide
that guard because a new document executes concurrently with the automation
event that reports it.

The designated main `Page` object must remain a hard invariant. Every cleanup
operation must verify that the object is open and still belongs to the fresh
browser context. If it is missing, the harness must fail; it must never try to
recover a main page by URL, position, or window name.

The implemented design is:

1. the harness establishes a per-run marker shared by the browser context and
   injects the matching main-page identity only into the designated `Page`;
2. `test/index.html` starts Mocha normally for manual runs, but in a marked
   automated context calls `mocha.run()` only when the page carries the
   matching main-page identity;
3. auxiliary documents therefore may load, but cannot begin a second Mocha
   execution; and
4. an awaited root `beforeEach` closes pages left by the previous test,
   verifies the hard main-page invariant, brings that exact page forward, and
   then releases the next test.

The next-test boundary remains preferable to root `afterEach` because it
follows the previous test's complete nested teardown under Mocha 1.0.1. Only
top-level `Page` objects other than the designated main object are eligible.
Frames, workers, browser UI, and other browser contexts are excluded. Cleanup
failure must fail the harness, and page creation, runner admission, and page
closure must remain diagnostic output.

## Implementation

The approved implementation adds one narrow bridge outside the Node harness:

- add `test/support/auxiliary-window-isolation.mjs` to install the root
  `beforeEach` bridge and describe its page-isolation contract;
- update `test/support/run-legacy-suite.mjs` to expose an awaited cleanup
  function, establish the per-run marker, preserve the main page by object
  identity, close eligible pages, restore it, and report diagnostics; and
- make a minimal `test/index.html` bridge change that admits the runner only
  on the designated automated main page while preserving ordinary manual
  execution.

The root test server accepts a dedicated no-content diagnostic endpoint, and
the Mocha observer verifies that every executing test body follows a
successful isolation barrier. `test/application_spec.js`, `lib/`, fixtures,
and vendored dependencies remain unchanged.

Before navigation, Puppeteer sets a per-run context cookie, injects the
matching identity only into the designated main `Page`, exposes the cleanup
function, and installs the hook. At `DOMContentLoaded`, after Mocha's BDD
globals exist but before `mocha.run()`, the installer registers a root
`beforeEach` callback using legacy Mocha's callback-style asynchronous hook.
The hook awaits the Node-side cleanup bridge before calling `done()`.

The harness continuously closes every top-level page other than the exact
original `Page`. Each barrier waits for pending closes, re-enumerates pages,
verifies the main object and its injected token, brings it to the foreground,
and repeats the drain before releasing the test. A missing or substituted
main page fails the run; URL, window name, and page order are never used for
recovery.

## Validation Evidence

Using the repository-pinned Node 24.20.0, two strict Chrome 152 runs retained
387 passing, 0 failing, 4 pending, and 391 unique tests. Every run observed
two auxiliary pages, two completed close operations, 387 completed barriers,
one stable final page, and exactly one runner start. Auxiliary documents that
reached the admission check were explicitly denied; none emitted a
runner-start event.

Under the same Node runtime, Firefox Stable 156.0 completed once headless and
once headed. Firefox ESR 140.16.0esr completed twice headed. All four Firefox
runs produced 387/0/4 across 391 tests, exactly one runner start, 387
completed barriers, two closed auxiliary pages, one final main page,
successful foreground restoration, and no page or required-resource errors.
The first Firefox attempt exposed a Puppeteer BiDi incompatibility with
URL-scoped cookie creation; defining the same admission cookie by host and
path works in Chrome and Firefox.

These results validate the cleanup policy. They do not independently resolve
the broader WebDriver BiDi investigation in issue #24 or reclassify the
accepted browser-support policy.

## Remaining Uncertainty and Deferred Work

- An auxiliary document may be closed before its admission beacon is sent, so
  the number of denied-document beacons is timing-dependent. The invariant is
  one admitted document and one runner start, combined with complete
  page-creation and close accounting.
- Browser transports may still differ outside the successful paths observed
  here; broader Firefox WebDriver BiDi limitations belong to
  [#24](https://github.com/jasonfigueroa/sammy/issues/24), not to a
  browser-specific exception in this policy.
- Edge's intermittent timeout remains an independent investigation in
  [#22](https://github.com/jasonfigueroa/sammy/issues/22).
- Broader cross-browser CI and dependency modernization remain deferred.
