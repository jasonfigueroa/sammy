# Sammy Routing Architecture

## Scope and Evidence

This document describes how Sammy registers, selects, and executes routes. It
follows dispatch from browser navigation or form submission through route
lookup, parameter construction, `Sammy.EventContext` creation, filters, and
callback execution.

Application construction, startup, shutdown, and listener retention are covered
in [`docs/application-lifecycle.md`](application-lifecycle.md). Rendering,
plugin-specific parameter grammars, and the broader jQuery dependency inventory
are outside this document's scope.

Evidence is classified as follows:

- **Observed from source:** directly follows from the current implementation.
- **Covered by tests:** an existing assertion exercises the stated behavior.
- **Unresolved:** current source and tests do not establish a meaningful stable
  contract.
- **Characterization candidate:** observable or compatibility-sensitive behavior
  worth protecting before implementation changes.

These categories describe evidence, not inferred design intent. A surprising or
weakly protected behavior is not necessarily a defect.

## Routing Overview

Sammy stores route records by verb on each application. Browser-driven GET
navigation reaches `_checkLocation()` through the location proxy; non-GET forms
call `runRoute()` directly. Direct callers may also bypass browser integration.

```text
hashchange / popstate / pushState / refresh
                    |
             location-changed
                    |
             _checkLocation()
                    |
                    +--------------------+
                                         |
non-GET form -----------------------> runRoute()
direct call ---------------------------> |
                                         v
                  lookup -> parameters -> EventContext
                                         |
                      around -> before -> callbacks / next
                                         |
                           event-context-after / onComplete
                           order depends on continuation timing
```

GET forms are different: Sammy serializes their fields into a URL and enters
the location-change dispatch path instead of calling `runRoute()` directly.
Notification may be immediate under pushState or browser/poll driven under hash
routing. **Observed from source:** [`_checkLocation()`, `_checkFormSubmission()`,
and parameter helpers](../lib/sammy.js#L1382-L1479).

## Route Registration

### Verb shortcuts and `any`

`route(verb, path, ...callbacks)` lowercases `verb`. `get()`, `post()`, `put()`,
and `del()` prepend their corresponding verb and delegate to `route()`; `any()`
passes the special verb `any`. The two-argument
`route(path, functionCallback)` form is treated as `any`; string callback lookup
is supported through the normal explicit-verb form. **Observed from source:**
[`_routeWrapper()` and `route()`](../lib/sammy.js#L32-L35),
[`route()`](../lib/sammy.js#L578-L628).

`ROUTE_VERBS` contains `get`, `post`, `put`, and `delete`. It controls which four
records `any` creates; it is not a validation list. A different verb supplied to
`route()` is lowercased and stored under its own key. Conversely, `runRoute()`
does not normalize its verb argument and looks up the exact key supplied.
Arbitrary registered verbs and direct-call case sensitivity are **observed from
source but not covered by focused tests**.

The shortcut, two-argument, and `any` expansion behavior is **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L125-L180).

### String-route compilation semantics

For a string path, `route()`:

1. Resets the shared named-parameter regular expression's `lastIndex`.
2. Collects names matching `:([\w\d]+)` in source order.
3. Replaces each named token with `([^/]+)`.
4. Appends `$`.
5. Passes the resulting string directly to `RegExp`.

The generated expression is end-anchored but not start-anchored. Other
regular-expression metacharacters in the supplied string are not escaped, so a
string route is a pattern rather than a literal path template. **Observed from
source:** [`route()`](../lib/sammy.js#L591-L605) and the route constants at
[`lib/sammy.js`](../lib/sammy.js#L17-L20).

Existing tests confirm conversion to `RegExp`, named-parameter collection, and
the trailing `$`; they do not establish behavior for other regex-significant
characters or overlapping patterns. **Covered in part by tests:**
[`test/application_spec.js`](../test/application_spec.js#L95-L110) and
[`test/application_spec.js`](../test/application_spec.js#L137-L160).

### Regular-expression routes

A caller-supplied `RegExp` is retained as the route's `path` without cloning or
normalization, and its capture groups have no registered parameter names.
Successful captures therefore become splats during execution. Partial regex
matching and splat extraction are **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L545-L565) and
[`test/application_spec.js`](../test/application_spec.js#L594-L609).

`lookupRoute()` uses the same regex object with `String#match()` that
`runRoute()` later uses with `RegExp#exec()`. The behavior of stateful caller
regexes, especially those using `g` or `y`, is **unresolved** because the suite
does not cover it and historical browser regex state may matter.

### Route records and definition order

Registration appends this record to `routes[verb]`:

```text
{
  verb: verb key,
  path: RegExp,
  callback: callback array,
  param_names: named-parameter array
}
```

Callbacks are always collected into an array by public `route()` signatures.
String callbacks are immediately replaced with the current application property
of that name. `mapRoutes()` simply passes each supplied array to `route()`.
**Observed from source and covered by tests:**
[`lib/sammy.js`](../lib/sammy.js#L578-L628),
[`test/application_spec.js`](../test/application_spec.js#L113-L180), and
[`test/application_spec.js`](../test/application_spec.js#L183-L211).

The defensive `runRoute()` branch that converts a function-valued
`route.callback` into an array is not produced by normal public registration.
It is best classified as a **defensive legacy branch**, not currently as a
characterization candidate. A string callback that fails to resolve is stored
as `undefined` in a non-empty callback array. If base route execution proceeds,
`nextRoute()` treats that entry as absent, invokes `_onComplete` when configured,
and then reaches `event-context-after`. This behavior is **observed from
source**; whether it is a supported contract is **unresolved**.

## Dispatch Entry Points

### Location-change gating and `last_location`

`_checkLocation()` reads the current proxy location. It dispatches only when
`last_location` is absent, represents a non-GET verb, or contains a different
path. Before calling `runRoute('get', location)`, it stores
`['get', location]`. Repeated GET checks for the same location are therefore
suppressed. **Observed from source:** [`_checkLocation()`](../lib/sammy.js#L1382-L1393).

`refresh()` forces another check by setting `last_location` to `null` and
triggering `location-changed`. The internal listener installed by `run()` then
calls `_checkLocation()`. **Observed from source:**
[`refresh()`](../lib/sammy.js#L731-L735) and
[`run()`](../lib/sammy.js#L990-L994). No focused test covers refresh or
same-location suppression, so both are **characterization candidates**.

### Initial and subsequent location checks

`run()` invokes `_checkLocation()` once during startup. It then binds the
location proxy and installs an internal `location-changed` listener for later
checks. The precise startup ordering is documented in the lifecycle document;
initial and later URL dispatch are **covered in part by tests:**
[`test/application_spec.js`](../test/application_spec.js#L302-L313) and
[`test/application_spec.js`](../test/application_spec.js#L472-L493).

### Link navigation and browser events

The default proxy turns `hashchange` and `popstate` into the application's
`location-changed` event. Its delegated link handler intercepts a click only
when the target has the current hostname, `lookupRoute('get', fullPath)` finds a
route, and the link targets the current window. It then changes location; it
does not call `runRoute()` directly. Push-state location changes explicitly
emit `location-changed`, while hash assignment relies on browser/hash polling
notification. **Observed from source:**
[`Sammy.DefaultLocationProxy.bind()` and `setLocation()`](../lib/sammy.js#L271-L357).

Push-state changes and eligible link interception are **covered by tests:**
[`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L83-L159).
Target-window exclusions are covered at
[`test/application_spec.js`](../test/application_spec.js#L316-L338).

### GET form submission

For a GET form, `_checkFormSubmission()` serializes successful form fields,
appends the query string to the action, and calls `setLocation(path)`. It enters
the location-change dispatch path rather than calling `runRoute()` directly;
notification can be immediate with pushState or browser/poll driven with hash
routing. No `target` is passed to the resulting `runRoute('get', location)`
call, so `EventContext.target` is not the submitted form. **Observed from source:**
[`_checkFormSubmission()`](../lib/sammy.js#L1405-L1425).

URL construction and encoding are **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L432-L470). The absence
of the GET form target from the eventual context is not directly asserted.

### Non-GET form submission

For other verbs, `_checkFormSubmission()` parses fields into an object and
calls `runRoute(verb, path, params, formElement)` immediately. `_getFormVerb()`
prefers a hidden `_method`, then the form's method, then `get`, and normalizes it
with trimming and lowercasing. **Observed from source:**
[`_getFormVerb()` and `_checkFormSubmission()`](../lib/sammy.js#L1396-L1425).

POST dispatch, future form handling, `_method`, uncommon form methods, and form
target propagation are **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L340-L430).

### Direct `runRoute()` calls

`runRoute()` can execute without `run()` and without a bound location proxy. It
receives the verb, path, optional parameters, and optional target directly.
Most parameter and callback-chain tests use this entry point:
[`test/application_spec.js`](../test/application_spec.js#L579-L713).

Direct calls bypass `_checkLocation()` gating and do not normalize verb case.
Those properties are **observed from source**; their status as supported public
contracts is **unresolved**. A direct call also emits routing events without
starting the application, but listeners retained through `app.bind()`—including
`after()`—are not attached to the DOM until `run()`. Event emission therefore
does not guarantee that a stored listener on an unstarted application executes.
**Observed from source:** [`bind()`](../lib/sammy.js#L677-L714),
[`after()`](../lib/sammy.js#L779-L783), and
[`run()`](../lib/sammy.js#L971-L980).

### Redirects and refresh

`EventContext.redirect()` builds a destination from string and object
arguments, emits `redirect`, assigns the current context's verb and path to
`app.last_location`, and calls `setLocation()`. If `new RegExp(to)` matches the
pre-redirect location, it explicitly triggers `location-changed`; this permits
same-path transitions such as a POST followed by a GET. **Observed from
source:** [`EventContext.redirect()`](../lib/sammy.js#L2078-L2117).

Destination construction is **covered by tests:**
[`test/event_context_spec.js`](../test/event_context_spec.js#L28-L52). A POST
redirecting to a GET at the same path is covered by
[`test/application_spec.js`](../test/application_spec.js#L519-L536). The full
interaction among regex destination matching, `last_location`, and browser
notification is only partially protected.

## Routing-Related Event Emission

Event names do not by themselves prove that an event is emitted. The current
production source establishes this routing-related sequence:

| Event | Emission point | Payload at emission |
| --- | --- | --- |
| `location-changed` | Proxy notification, `refresh()`, or a redirect whose destination regex matches the current location | Usually none |
| `check-form-submission` | Before form action, verb, or fields are read | `{form}` |
| `run-route` | After lookup, before parameter defaulting/parsing | `{verb, path, params}` |
| `route-found` | After query parsing when lookup succeeded, before path extraction | `{route}` |
| `event-context-before` | After matching before filters and `last_route` assignment | `{context}` |
| `event-context-after` | After the initial callback-chain invocation returns | `{context}` |
| `redirect` | Before `last_location` assignment and location change | `{to}` |

**Observed from source:** [`APP_EVENTS`](../lib/sammy.js#L415-L417),
[`runRoute()`](../lib/sammy.js#L1102-L1199),
[`_checkFormSubmission()`](../lib/sammy.js#L1405-L1425), and
[`EventContext.redirect()`](../lib/sammy.js#L2088-L2117).

`lookup-route` is listed in `APP_EVENTS`, but neither `lookupRoute()` nor another
current production source location emits it. No routing-event ordering test
covers these events as a group. The absence of emission is **observed from the
current source**; whether consumers expect the declared event is **unresolved**.

## Route Lookup

### Routable paths

`routablePath()` removes a query component matched at the end of the supplied
path. `lookupRoute()` and later path extraction both use the resulting path, so
query text does not enter normal named or splat captures. **Observed from source
and covered by tests:** [`routablePath()` and `lookupRoute()`](../lib/sammy.js#L1060-L1080)
and [`test/application_spec.js`](../test/application_spec.js#L567-L575).

### Verb selection and first-match precedence

`lookupRoute(verb, path)` examines only `routes[verb]`, in array order, and
returns the first route for which `routablePath(path).match(route.path)` is
truthy. It returns `false` when that exact verb collection is missing or no
entry matches. Routes are appended during registration, so overlapping matches
are resolved by definition order. **Observed from source:**
[`route()`](../lib/sammy.js#L613-L625) and
[`lookupRoute()`](../lib/sammy.js#L1066-L1080).

Existing tests cover verb-specific lookup, partial regex matches, and query
removal, but do not directly assert first-match behavior for overlapping
routes. **Covered in part:** [`test/application_spec.js`](../test/application_spec.js#L540-L576).
Overlapping-route precedence is a **characterization candidate**.

### Unmatched routes

`runRoute()` emits `run-route` even when its earlier lookup found nothing. It
does not emit `route-found`, construct an `EventContext`, or run filters; it
delegates to `notFound(verb, path)`. **Observed from source:**
[`runRoute()`](../lib/sammy.js#L1102-L1199).

## Parameter Construction

For a matched route, `runRoute()` builds parameters in this order:

| Parameter source | Applied when | Collision behavior |
| --- | --- | --- |
| Caller-supplied object | Initial input | Establishes initial properties |
| Query string | Before `route-found` and path extraction | `$.extend` overwrites same-named supplied properties |
| Named path captures | After query parsing | Assignment overwrites same-named supplied or query properties |
| Unnamed path captures | During path extraction | Appended to `params.splat`, creating the array when absent |
| Non-GET form fields | Passed as caller-supplied input | May be overwritten by action-query and named path values |

The original caller-supplied object is mutated by query extension, named
capture assignment, and splat accumulation. `EventContext` then wraps the
result in a new `Sammy.Object`, shallow-copying its properties into the
context's own parameter object. **Observed from source:**
[`Sammy.Object`](../lib/sammy.js#L112-L114),
[`runRoute()`](../lib/sammy.js#L1119-L1153), and
[`Sammy.EventContext`](../lib/sammy.js#L1958-L1964).

The collision order and caller-object mutation follow directly from the source
but are not asserted by existing tests. They are **characterization
candidates** rather than established compatibility promises.

`_parseQueryString()` decodes names and values, converts `+` to a space, maps a
missing value to an empty string, and uses `_parseParamPair()` to accumulate
repeated names into arrays. Core form parsing uses the same accumulation helper.
**Observed from source:** [decode and query constants](../lib/sammy.js#L17-L28)
and [parameter helpers](../lib/sammy.js#L1428-L1479).

Named, splat, query, empty, and decoded values are **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L585-L669). Core tests
do not cover collisions among parameter sources. Nested form structures belong
to `Sammy.NestedParams` and are outside this core routing document.

## EventContext Creation

After query and path parameters are applied, `runRoute()` constructs
`new this.context_prototype(this, verb, path, params, target)`. The resulting
context holds:

| Field | Value |
| --- | --- |
| `app` | The dispatching application |
| `verb` | The verb supplied to `runRoute()` |
| `path` | The original path, including any query string |
| `params` | A new `Sammy.Object` populated from the constructed parameters |
| `target` | The optional dispatch target, normally a non-GET form element |

Using `context_prototype` makes application helpers available during route
execution. **Observed from source:** [`runRoute()`](../lib/sammy.js#L1144-L1153),
[`Sammy.EventContext`](../lib/sammy.js#L1945-L1966), and the helper discussion in
[`docs/application-lifecycle.md`](application-lifecycle.md#use-and-helpers).

Context fields are **covered by tests:**
[`test/event_context_spec.js`](../test/event_context_spec.js#L13-L25).
Route callbacks receiving the same context as `this` and their first argument
are covered at [`test/application_spec.js`](../test/application_spec.js#L484-L493)
and [`test/application_spec.js`](../test/application_spec.js#L602-L609).

## Filters and Callback Sequencing

### Filter matching

`before()` stores `[options, callback]`; an omitted options argument becomes an
empty object. During dispatch, each copied record is checked with
`contextMatchesOptions()`.

| Options form | Matching behavior |
| --- | --- |
| Empty | Always matches |
| String or `RegExp` | Normalized as `path` |
| `only` | Returns the nested positive match |
| `except` | Negates the combined nested match |
| Path array | Matches when any path matches |
| Verb string | Requires exact equality |
| Verb array | Requires membership |
| Path and verb | Requires both before optional negation |

String paths are compiled with a trailing `$` but no leading anchor. For a
plain options object, this assignment replaces `options.path` with the compiled
`RegExp`, mutating the supplied object. **Observed from source:**
[`before()`](../lib/sammy.js#L738-L776) and
[`contextMatchesOptions()`](../lib/sammy.js#L1202-L1291).

The matching forms are extensively **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L1034-L1126). Mutation
of the options object and stateful supplied-regex behavior are not asserted and
remain **characterization candidates** only if later modernization would alter
them.

### Exact synchronous sequence

For a found route, `runRoute()` performs this sequence:

1. Looks up the route.
2. Optionally logs the dispatch when `debug` is true.
3. Emits `run-route` with the original `params` argument.
4. Creates an empty parameter object if needed and overlays query parameters.
5. Emits `route-found`.
6. Executes the route regex, decodes captures, and applies named parameters or
   splats.
7. Constructs the `EventContext` and copies the around and before arrays.
8. Builds callback arguments as `context`, followed by splats when present, and
   finally the route-local `nextRoute` function.
9. Wraps the base route execution with around filters.
10. Invokes the outer wrapper inside `try`.
11. When the wrappers proceed, evaluates matching before filters in definition
    order; `false` stops the base route.
12. Assigns `app.last_route`, emits `event-context-before`, and invokes the first
    route callback.
13. Each explicit `next()` advances to another callback; `next()` after the last
    callback invokes `onComplete` when configured.
14. Emits `event-context-after` when the initial callback-chain invocation
    returns.
15. Returns the synchronous wrapper result, or passes a caught synchronous
    execution error to `app.error()`.

**Observed from source:** [`runRoute()`](../lib/sammy.js#L1102-L1199).

### Around and before filters

Around filters are copied and reversed while wrappers are built, making the
first registered around filter the outermost wrapper. Each runs with the route
context as `this` and decides whether to invoke the next inner wrapper. Before
filters execute only after every enclosing around filter invokes its
continuation. A matching before filter returning `false` prevents remaining before
filters, route callbacks, and the context before/after events from running.
If an around filter defers its continuation, the entire inner sequence is also
deferred and later executes outside the original synchronous `try` stack.

**Observed from source and covered by tests:**
[`lib/sammy.js`](../lib/sammy.js#L1147-L1192) and
[`test/application_spec.js`](../test/application_spec.js#L716-L905).

### Callback chains, `onComplete`, and after

Callbacks do not advance automatically. Each callback must invoke the appended
`next` argument to reach the next callback or, after the last, `onComplete`.
The existing suite covers asynchronous callback chaining and asynchronous
arrival at `onComplete`: [`test/application_spec.js`](../test/application_spec.js#L680-L713).
`onComplete()` assigns one `_onComplete` slot, so a later registration replaces
the earlier callback; unlike `after()`, it does not build a listener collection.
**Observed from source:** [`onComplete()`](../lib/sammy.js#L886-L888).

`event-context-after` is emitted after the initial `nextRoute()` invocation
returns. If a callback defers `next()`, the after event is therefore emitted
before the remaining callbacks and `onComplete`. If every callback advances
synchronously, the after event follows the complete chain. This timing is
**observed from source but not directly covered** and is a **characterization
candidate**.

The value returned by the synchronous wrapper becomes `runRoute()`'s return
value. A later asynchronous `next()` can update the closed-over local variable,
but cannot change the value already returned to the caller. Return behavior
across callback and around-filter combinations is weakly covered.

### Synchronous execution and error boundary

The `try` in `runRoute()` begins only when the completed around-filter wrapper
is invoked.

| Outside the `try` | Inside it while execution remains synchronous |
| --- | --- |
| Route lookup and debug logging | Around-filter callbacks |
| `run-route` emission | Before-filter matching and callbacks |
| Query parsing and extension | `event-context-before` handlers |
| `route-found` emission | Route callbacks and synchronous `next()` calls |
| Regex execution and capture decoding | Synchronously reached `onComplete` |
| `EventContext` construction | `event-context-after` handlers |
| Filter copying and wrapper construction | Around-filter continuation after the inner call |

Exceptions from the right column are passed to `app.error()`. Operations
resumed later by an asynchronous around callback or `next()` execute after the
original `try` stack has returned, so their exceptions are not caught by this
boundary. **Observed from source:** [`runRoute()`](../lib/sammy.js#L1102-L1199).
The existing tests establish successful asynchronous chaining, not asynchronous
error propagation. Exact asynchronous failure handling remains **unresolved**.

## Errors and Unmatched Routes

When lookup fails, `runRoute()` calls `notFound()` outside its route-execution
`try`. `notFound()` calls `error()`. The default error handler creates or
augments an `Error`, emits `error`, and either throws when `raise_errors` is true
or logs and returns `undefined`. If no throw occurs, `notFound()` returns that
value for lowercase `get` and `true` for other verbs. **Observed from source:**
[`notFound()` and `error()`](../lib/sammy.js#L1357-L1379).

The suite covers a throwing unmatched GET and a non-throwing browser-driven
GET: [`test/application_spec.js`](../test/application_spec.js#L508-L516) and
[`test/application_spec.js`](../test/application_spec.js#L672-L678). Non-GET
return behavior, failures before the execution `try`, and failures after async
continuation are weakly protected or unresolved.

## Observable Routing Sequence

For an ordinary browser-driven GET whose location changed and whose callback
chain advances synchronously, the source-observed path is:

```text
browser event or pushState
  -> DefaultLocationProxy emits location-changed
  -> application's retained location-changed listener calls _checkLocation()
  -> _checkLocation() compares and updates last_location
  -> runRoute('get', currentLocation)
  -> lookupRoute() strips the query for matching and selects the first match
  -> run-route
  -> query parameters
  -> route-found
  -> named parameters and splats
  -> new application-specific EventContext
  -> around filters
  -> matching before filters
  -> event-context-before
  -> route callback and explicit next() chain
  -> optional onComplete
  -> event-context-after
```

GET forms join this path by changing location. Non-GET forms enter at
`runRoute()` with form parameters and the form element as `target`. Direct
`runRoute()` calls enter at the same point without browser gating.

## Evidence Index

### Source references

- Route constants and wrappers: [`lib/sammy.js`](../lib/sammy.js#L17-L35)
- Default location proxy: [`lib/sammy.js`](../lib/sammy.js#L255-L378)
- Route registration and shortcuts: [`lib/sammy.js`](../lib/sammy.js#L560-L668)
- Refresh and filters: [`lib/sammy.js`](../lib/sammy.js#L731-L888)
- Startup dispatch integration: [`lib/sammy.js`](../lib/sammy.js#L971-L1009)
- Lookup and execution: [`lib/sammy.js`](../lib/sammy.js#L1060-L1200)
- Filter-option matching: [`lib/sammy.js`](../lib/sammy.js#L1202-L1291)
- Errors, location gating, forms, and parameters: [`lib/sammy.js`](../lib/sammy.js#L1357-L1479)
- `EventContext` construction and redirect: [`lib/sammy.js`](../lib/sammy.js#L1945-L1964),
  [`lib/sammy.js`](../lib/sammy.js#L2078-L2125)

### Test references

- Registration and route records: [`test/application_spec.js`](../test/application_spec.js#L81-L211)
- Browser, link, and form dispatch: [`test/application_spec.js`](../test/application_spec.js#L285-L538)
- Lookup, parameters, and callback chains: [`test/application_spec.js`](../test/application_spec.js#L540-L713)
- Before, after, and around filters: [`test/application_spec.js`](../test/application_spec.js#L716-L905)
- Filter-option matching: [`test/application_spec.js`](../test/application_spec.js#L1034-L1126)
- Location proxy integration: [`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L76-L198)
- `EventContext` fields and redirects: [`test/event_context_spec.js`](../test/event_context_spec.js#L13-L52)

## Unresolved Questions

- What contract, if any, exists for caller-supplied route regexes with stateful
  flags such as `g` or `y` across matching and capture extraction?
- Are arbitrary verbs registered through `route()` and exact-case direct
  `runRoute()` dispatch supported behavior or only consequences of missing
  validation?
- Does any consumer rely on `lookup-route`, which is declared in `APP_EVENTS`
  but not emitted by current production source?
- How should errors from async around-filter or `next()` continuation relate to
  `app.error()` after `runRoute()` has returned?
- Does any consumer rely on unresolved string callbacks, the defensive
  function-valued callback branch, or callback arrays modified outside public
  registration?
- Which parameter-collision and caller-object mutation behaviors are relied upon
  by applications?
- Is the absence of a submitted GET form from `EventContext.target` observable
  to consumers?
- Which synchronous callback or wrapper return values are used by direct
  `runRoute()` callers or form submission handling?

## Characterization-Test Candidates

Candidates are prioritized by compatibility sensitivity, not by presumed
incorrectness:

Issue #8 now covers first-match precedence for identical routes, path/query/
caller parameter precedence and caller-object mutation, the distinct shallow
copy used for `EventContext.params`, and async `next()` timing relative to
`event-context-after` and `onComplete`. These tests protect observed behavior;
they do not endorse it. **Covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L718-L788) and
[`test/event_context_spec.js`](../test/event_context_spec.js#L27-L41).

1. String-route regex semantics and precedence questions beyond identical
   routes.
2. Stateful caller-supplied `RegExp` matching and capture extraction.
3. Synchronous errors before and during the route-execution boundary, contrasted
   with errors after asynchronous continuation.
4. Around-filter nesting, short-circuiting, and return propagation.
5. GET versus non-GET form target propagation into `EventContext`.
6. Arbitrary registered verbs and normalization of direct `runRoute()` verbs.
7. `contextMatchesOptions()` mutation and stateful-regex behavior.
8. Declared but non-emitted `lookup-route` behavior, if consumer evidence makes
    it a meaningful contract.

Issue #5 records these gaps but does not add the tests. Targeted protection
belongs in issue #8 after prioritization.
