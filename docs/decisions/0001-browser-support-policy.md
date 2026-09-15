# Adopt a bounded evergreen desktop browser target

## Status

Accepted

## Context

Sammy has historical compatibility references but no maintained browser matrix.
Its surviving package metadata declares jQuery `>=1.4.1`, while current source
paths, optional plugins, and the authoritative jQuery 1.7.2 test environment
have different API floors. Historical browser claims therefore cannot be
treated as a verified modern support contract.

The current harness provides reproducible evidence only for Chrome for Testing
152.0.7977.75: 387 passing, 0 failing, 4 pending, and 391 unique tests. Chrome,
Edge, and Firefox now use rapid release cycles; all three also provide slower
enterprise channels or release lines. Branded Safari is available only on
Apple platforms and cannot be replaced as evidence by a generic WebKit build.

The detailed evidence, alternatives, and maintenance costs are recorded in
[`docs/browser-compatibility.md`](../browser-compatibility.md).

## Decision

Target core Sammy on these moving desktop-browser windows:

- Google Chrome: current Stable and two preceding Stable majors, plus current
  Extended Stable.
- Microsoft Edge: current and two preceding Stable majors, plus current and one
  preceding Extended Stable major.
- Mozilla Firefox: current and preceding Rapid Release, plus every
  Mozilla-supported ESR generation.
- Apple Safari: current and immediately preceding stable major available on
  supported macOS releases.

Mobile browsers, Internet Explorer, Edge Legacy, and other browsers are outside
the initial target. Pre-release browsers and generic WebKit runs are advisory,
not substitutes for the corresponding branded stable browser.

Core `lib/sammy.js` is the primary support surface. Plugins loaded by the
authoritative suite are inside its verification surface for exercised behavior;
the seven first-party plugins not loaded by that suite remain legacy or
unverified until they gain focused evidence.

Target support, automated verification, and observed compatibility are distinct.
This decision sets the target; it does not claim that untested browsers already
pass. The current Chrome harness remains the only automated gate until later
work adds cross-browser verification.

Until another decision introduces transpilation, polyfills, or multiple
distribution targets, production syntax and browser APIs must execute natively
throughout this target. jQuery version support remains a separate decision.

## Consequences

- Compatibility-affecting changes must consider the oldest release in every
  target window, even before every combination is automated.
- Browser versions recorded by automation must be exact and pins must be
  refreshed before they leave the target window.
- Cross-browser automation, real Safari access, and the split between per-change
  and periodic verification become explicit follow-up work.
- Chrome success does not establish Edge success, and WebKit automation does
  not establish Safari success.
- Historical browsers and unverified plugins are preserved as source but carry
  no current compatibility promise.
- The policy permits incremental syntax and API modernization only when the
  resulting production code runs natively across the full accepted target.
- The unsupported jQuery 1.7.2 baseline remains a separate compatibility and
  maintenance risk; this ADR neither upgrades jQuery nor claims compatibility
  with maintained jQuery releases.
