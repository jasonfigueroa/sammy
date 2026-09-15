# Sammy Application Lifecycle

## Scope

This document describes how a Sammy application is located or created,
configured, started, connected to browser events, stopped, restarted, and
deregistered. It treats route registration and filters as retained application
configuration, but defers route matching, parameter parsing, `EventContext`
construction, filter execution order, and callback chaining to the routing
architecture investigation in issue #5.

Evidence is classified as follows:

- **Observed from source:** directly follows from the current implementation.
- **Covered by tests:** an existing assertion exercises the stated behavior.
- **Unresolved:** the current evidence does not establish the behavior.
- **Characterization candidate:** observable behavior worth protecting before
  the implementation changes.

## Lifecycle State Model

```text
Constructed / configured
        |
       run()
        v
     Running
        |
     unload()
        v
     Stopped
       / \
  run()   destroy()
    |        |
    v        v
 Running   Deregistered
```

`destroy()` may also be called while running; it calls `unload()` before
deregistering the application.

These states describe the application object and its registration, not whether
all browser activity has ceased:

- **Constructed/configured:** the object exists and `_running` resolves to
  `false`. Routes, listeners, filters, helpers, and plugins may already be
  configured. A default location proxy may already have started its shared
  polling mechanism. **Observed from source.**
- **Running:** after a normal, uninterrupted `run()` completes, `_running` is
  `true`; application listeners and the location proxy are bound, and form and
  browser-unload integration has been installed. Startup passes through
  observable intermediate steps before reaching this complete state.
  **Observed from source.**
- **Stopped:** `unload()` has set `_running` to `false` and removed specified
  DOM and location-proxy bindings. Routes, listener records, filters, helpers,
  other configuration, registry membership, and external references remain.
  **Observed from source.**
- **Deregistered:** `destroy()` has attempted to unload the application and has
  deleted `Sammy.apps[element_selector]`. The JavaScript object is not erased;
  external references still point to it. **Observed from source.** Registry
  removal and creation of a different application for the same selector are
  **covered by tests**.

## Application Lookup and Creation

### `Sammy()`

Calling `Sammy()` with no arguments, or with a configuration function as its
first argument, delegates to `Sammy('body', ...)`. Calling it with a selector
looks up `Sammy.apps[selector]` and creates a `Sammy.Application` only when no
entry exists. Additional arguments are passed to `use()`, allowing an existing
selector-bound application to be extended rather than replaced. If extension
changes `element_selector`, the wrapper removes the original registry key and
registers the application under its resulting selector. **Observed from
source:** [`lib/sammy.js`](../lib/sammy.js#L42-L87).

Default lookup, selector assignment, registry storage, instance reuse, and
extension of a reused instance are **covered by tests**:
[`test/application_spec.js`](../test/application_spec.js#L8-L40).

Constructing `new Sammy.Application()` directly does not add the object to
`Sammy.apps`; registration is performed by the `Sammy()` wrapper. **Observed
from source.** No focused test asserts this distinction.

### Application construction

The constructor performs these steps in order:

1. Creates new `routes` and `listeners` objects and new `arounds` and `befores`
   arrays.
2. Generates an application event namespace.
3. Creates an application-specific `context_prototype` inheriting from
   `Sammy.EventContext`.
4. Invokes the optional `app_function` with the application as both `this` and
   its first argument.
5. Installs a `Sammy.DefaultLocationProxy` only if configuration did not set a
   location proxy.
6. If debugging is enabled, registers a callback for all known application
   events.

**Observed from source:**
[`Sammy.Application`](../lib/sammy.js#L381-L408). Initialization of arbitrary
settings, the namespace, routes, callback argument, and default proxy is
**covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L47-L78).

### Initial state

`_running`, `_location_proxy`, and `_last_route` are defined on the application
prototype. Absent configuration that overwrites these fields, construction
gives each application its own location proxy while `_running` remains
inherited as `false` until `run()` assigns an instance value. The
constructor-created collections and namespace are per instance. **Observed
from source:** [`lib/sammy.js`](../lib/sammy.js#L385-L439).

### Location proxy initialization

The configuration function runs before default-proxy fallback. It can call
`setLocationProxy()` and thereby prevent construction of a default proxy.
**Observed from source.** `DataLocationProxy` configuration during construction
is exercised in [`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L201-L209),
although the absence of a discarded default proxy is not asserted directly.

If fallback is needed, the constructor passes the application's
`run_interval_every` value to `Sammy.DefaultLocationProxy`. The application
default is 50 ms. `_startPolling()` uses its own 10 ms fallback only when the
supplied value is falsy. Therefore an unmodified application requests a 50 ms
polling interval. **Observed from source:**
[`lib/sammy.js`](../lib/sammy.js#L255-L260),
[`lib/sammy.js`](../lib/sammy.js#L359-L375), and
[`lib/sammy.js`](../lib/sammy.js#L434-L435).

### Constructor-time browser observation

Constructing `Sammy.DefaultLocationProxy` immediately calls `_startPolling()`;
it does not wait for `Application.run()`. The first location check also runs
synchronously while the interval is created and can schedule a synthetic
`hashchange`. The proxy's application-facing `hashchange` listener is not
installed until `bind()`, but the shared polling mechanism may already be
active. Consequently, `_running === false` is not equivalent to complete
browser inactivity. **Observed from source.** Poller creation and sharing are
conditionally **covered by tests** on browsers without native hash-change
support: [`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L19-L46).

The polling interval and last observed location are stored on
`Sammy.DefaultLocationProxy` itself rather than on each proxy instance.
Multi-application effects are a **characterization candidate**.

## Configuration and Extensions

### `use()` and helpers

`use()` synchronously invokes a plugin with the application as `this`, prepends
the application to the plugin arguments, and returns the application. Plugins
can add routes, methods, helpers, listeners, or arbitrary configuration.
**Observed from source** and **covered by tests**:
[`lib/sammy.js`](../lib/sammy.js#L460-L526) and
[`test/application_spec.js`](../test/application_spec.js#L1129-L1232).

`helpers()` and `helper()` extend the application-specific context prototype.
Those extensions remain on the application object across stop and restart.
**Observed from source.** Availability in route and bound-event contexts, and
isolation from the global `Sammy.EventContext` prototype, are **covered by
tests:** [`test/application_spec.js`](../test/application_spec.js#L908-L980)
and [`test/application_spec.js`](../test/application_spec.js#L1186-L1217).

### Application events

`bind()` wraps a callback, appends that wrapper to the application's retained
`listeners[name]` array, and returns the application. Before startup, the
callback is recorded but not attached to the DOM. While running, it is also
attached immediately to the application element under the application's unique
event namespace. `trigger()` emits the namespaced event on that element and
returns the application. **Observed from source:**
[`lib/sammy.js`](../lib/sammy.js#L671-L729).

Listener storage, inability to trigger a stored Sammy callback before startup,
late registration while running, DOM event handling, and callback context are
**covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L214-L283).

### Filters and route registration

`before()` and `around()` append callbacks to retained arrays. `after()` is an
application event listener for `event-context-after`. Route registration stores
route records in `routes`. None of these collections is cleared by `unload()`
or `destroy()`. **Observed from source.** Their detailed execution semantics are
deferred to issue #5.

## Startup

### Exact `run()` sequence

For a successful call, `run(start_url)` performs this order:

1. Returns `false` immediately if `isRunning()` is already true.
2. Binds every callback currently stored in `listeners` to the application
   element.
3. Triggers the `run` application event.
4. Sets `_running = true`.
5. Resets `last_location` to `null`.
6. If the current location lacks a non-empty hash and `start_url` was supplied,
   passes `start_url` to the location proxy.
7. Calls `_checkLocation()`, which may initiate route dispatch.
8. Calls the location proxy's `bind()` method.
9. Registers an internal `location-changed` listener that calls
   `_checkLocation()`.
10. Registers an internal `submit` listener for form integration.
11. Registers an unnamespaced `unload` handler on `window` that calls
    `app.unload()`.
12. Triggers `changed` and returns its result, which is the application.

**Observed from source:** [`lib/sammy.js`](../lib/sammy.js#L957-L1010).
Starting-location behavior, initial dispatch, form integration, later location
changes, and application event handling are **covered in part by tests:**
[`test/application_spec.js`](../test/application_spec.js#L285-L538).

### Observable ordering consequences

- A `run` event callback observes `isRunning() === false`, because the event
  precedes the state assignment. **Observed from source; characterization
  candidate.**
- A callback added with `bind()` from inside the `run` event is stored after the
  initial listener-binding pass but while `_running` is still false. It is
  therefore not attached during that startup pass. **Observed from source;
  characterization candidate.**
- Initial location checking and possible route dispatch occur before the proxy
  is bound and before the internal `location-changed` and `submit` callbacks
  are registered. **Observed from source.** The current tests exercise initial
  dispatch but do not assert this complete ordering.
- An initial route callback can call `unload()` while `run()` remains on the
  stack. `run()` does not check `_running` again afterward, so it continues by
  binding the proxy, recording its internal listeners, installing a window
  handler, and triggering `changed`. Because `_running` is already false, the
  new internal listeners are retained but are not immediately DOM-bound. The
  resulting object can therefore report stopped while the proxy has been
  rebound. **Observed from source; characterization candidate.** Existing
  tests call `unload()` from initial routes as cleanup but do not assert the
  resulting lifecycle state.
- A successful call returns the application; a call made while already running
  returns `false`. **Observed from source; not directly covered by a focused
  test.**

These facts describe ordering only. The available evidence does not establish
why the implementation chose it.

## Runtime Browser Integration

### Location changes and links

The default proxy owns location-related browser integration. `bind()` attaches
a namespaced `hashchange` handler and, when History API support is used,
attaches `popstate` and delegated link-click handlers. The handlers notify the
application through `location-changed`; the internal listener installed by
`run()` then calls `_checkLocation()`. **Observed from source:**
[`lib/sammy.js`](../lib/sammy.js#L271-L320).

Hash/history changes and applicable link handling are **covered by tests:**
[`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L48-L187).
The rules for route lookup and deciding whether a link is routable are deferred
to issue #5.

### Forms

The application, rather than the location proxy, owns form integration.
`run()` registers a listener on the application element. The callback leaves
forms targeting another window to native browser behavior; otherwise it passes
the form to `_checkFormSubmission()`. **Observed from source.** Binding to
existing and future forms, target-window exclusion, GET location changes, and
non-GET routing are **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L340-L470).
Verb, parameter, and route-dispatch mechanics are deferred to issue #5.

### Late event-listener registration

Because `_running` is true after startup, later calls to `bind()` both retain
the wrapper in `listeners` and attach it immediately. **Observed from source
and covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L248-L281).

### Replacing the location proxy

Before startup, `setLocationProxy()` replaces the application reference but
does not unbind the old proxy or bind the new one. During construction, a
custom proxy installed by `app_function` prevents default-proxy construction.
Replacing an already-created default proxy before `run()`, however, does not
explicitly stop that proxy's constructor-started poller. **Observed from
source; characterization candidate.**

While running, `setLocationProxy()` assigns the new proxy, unbinds the previous
proxy if present, and then binds the new proxy. It does not change `_running`
and has no explicit return value. Any state held internally by the old proxy is
outside the application's cleanup. **Observed from source:**
[`lib/sammy.js`](../lib/sammy.js#L528-L553). Existing tests cover configuring a
data proxy during construction, but not replacement before or during startup.

## Shutdown, Restart, and Destruction

### Exact `unload()` sequence

`unload()` performs this order:

1. Returns `false` immediately if `isRunning()` is already false.
2. Triggers the `unload` application event while `_running` is still true.
3. Calls the current location proxy's `unbind()` method.
4. Calls `unbind('submit')` on the application element and removes a class named
   for the application event namespace.
5. Iterates over every callback retained in `listeners` and removes its
   namespaced DOM binding.
6. Sets `_running = false`.
7. Returns the application.

**Observed from source:** [`lib/sammy.js`](../lib/sammy.js#L1012-L1031).
There is no dedicated `unload()` test group; most existing calls use it only as
test cleanup.

### What is removed and retained

The current implementation yields this state after successful unload:

| Concern | Result | Evidence |
| --- | --- | --- |
| `_running` | Set to `false` | Observed from source |
| Location-proxy browser bindings | `unbind()` is invoked | Observed from source |
| Application listener DOM bindings | Removed callback by callback | Observed from source |
| Submit handlers on the application element | Removed broadly by event type | Observed from source and vendored jQuery |
| Routes, listener records, filters, helpers, and configuration | Retained | Observed from source |
| `last_location` and other application fields | Not reset by `unload()` | Observed from source |
| `Sammy.apps` registration | Retained | Observed from source |
| Window `unload` handler added by `run()` | No removal is visible | Observed from source |
| External references to the object | Unchanged | JavaScript object-reference behavior |

Sammy calls `this.$element().unbind('submit')` without a callback or namespace.
In the vendored jQuery, `unbind(types, fn)` delegates to `off(types, null, fn)`,
and an omitted callback leaves removal scoped only by the event type. Thus this
operation can remove submit handlers not installed by Sammy. **Observed from
source:** [`lib/sammy.js`](../lib/sammy.js#L1021-L1022) and
[`vendor/jquery.js`](../vendor/jquery.js#L3812-L3848). Whether applications rely
on unrelated submit handlers surviving unload is **unresolved** and a
**characterization candidate**.

### Repeated `run()` / `unload()` cycles

Each successful `run()` adds new internal `location-changed` and `submit`
wrappers through `bind()`. `bind()` appends them to the retained `listeners`
collection.
`unload()` removes their DOM bindings but does not remove their listener
records. On the next `run()`, all retained wrappers are rebound before another
pair is appended and immediately bound. Internal callbacks therefore
accumulate across successful restart cycles. **Observed from source; not
explicitly tested; characterization candidate.**

Every successful `run()` also adds a new unnamespaced window `unload` callback.
No matching removal appears in `unload()`. Repeated runs therefore accumulate
window callbacks, although callbacks invoked after the first successful unload
will encounter the already-stopped guard. **Observed from source; not
explicitly tested; characterization candidate.**

For the default proxy, `unbind()` clears the shared polling interval once its
binding count reaches zero. Rebinding the same proxy does not explicitly call
`_startPolling()`. Restart behavior in a browser that depends on polling rather
than native hash-change events is **unresolved** and a **characterization
candidate**.

### `destroy()` and object lifetime

`destroy()` calls `unload()`, deletes the current selector entry from
`Sammy.apps`, and returns the application. It performs registry removal even if
the application was already stopped and `unload()` returned `false`. It does
not clear routes, listeners, helpers, filters, configuration, or external
references. **Observed from source:**
[`lib/sammy.js`](../lib/sammy.js#L1033-L1038).

Registry removal and subsequent creation of a different selector-bound
application are **covered by tests:**
[`test/application_spec.js`](../test/application_spec.js#L1251-L1263).
Running an externally retained, deregistered object again appears possible from
the source but is **unresolved as a supported contract**.

## Observable Lifecycle Summary

```text
Sammy(selector)
  -> reuse registered application, or construct and register one
  -> configure routes, listeners, filters, helpers, plugins, and proxy
  -> run()
       bind retained listeners
       emit run while _running is false
       set _running true
       establish starting location and perform initial location check
       bind proxy and install internal/browser handlers
       emit changed and return the application
  -> event-driven runtime
  -> unload()
       emit unload while _running is true
       unbind proxy and application-element handlers
       set _running false while retaining configuration and registry entry
  -> run() again, or destroy()
       destroy deregisters but does not erase the object
```

The lifecycle is not a complete reset cycle. Construction may begin location
polling before startup, and stopping retains the configuration needed for a
possible restart. **Observed from source.** The exact restart behavior is only
partially protected by the existing suite.

## Evidence Index

### Source references

- Application lookup and registry: [`lib/sammy.js`](../lib/sammy.js#L42-L87)
- Default location proxy: [`lib/sammy.js`](../lib/sammy.js#L231-L378)
- Application constructor and defaults: [`lib/sammy.js`](../lib/sammy.js#L381-L448)
- Plugins and proxy replacement: [`lib/sammy.js`](../lib/sammy.js#L460-L553)
- Events and retained listeners: [`lib/sammy.js`](../lib/sammy.js#L671-L729)
- Filters and helpers: [`lib/sammy.js`](../lib/sammy.js#L738-L955)
- Startup, shutdown, and destruction: [`lib/sammy.js`](../lib/sammy.js#L957-L1038)
- Location/form lifecycle boundaries: [`lib/sammy.js`](../lib/sammy.js#L1382-L1425)
- DOM listener helpers: [`lib/sammy.js`](../lib/sammy.js#L1482-L1488)
- Vendored jQuery event removal: [`vendor/jquery.js`](../vendor/jquery.js#L3812-L3848)

### Test references

- Registry and construction: [`test/application_spec.js`](../test/application_spec.js#L8-L78)
- Event binding before and after startup: [`test/application_spec.js`](../test/application_spec.js#L214-L283)
- Startup and browser integration: [`test/application_spec.js`](../test/application_spec.js#L285-L538)
- Filters and helpers: [`test/application_spec.js`](../test/application_spec.js#L716-L980)
- Plugin configuration: [`test/application_spec.js`](../test/application_spec.js#L1129-L1232)
- Destruction: [`test/application_spec.js`](../test/application_spec.js#L1251-L1263)
- Default and data location proxies: [`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L1-L248)

## Unresolved Questions

- How many internal location and submit callbacks execute after successive
  `run()` / `unload()` cycles?
- How many window `unload` callbacks remain after successive cycles, and does
  their repeated invocation have observable effects?
- What stable state and bindings should result when an initial route calls
  `unload()` before the enclosing `run()` call has completed?
- Does a listener registered from a `run` event remain inactive until a later
  restart?
- What happens to constructor-started polling when an already-created default
  proxy is replaced before the first `run()`?
- Can the same default proxy resume location polling after unload in a browser
  without native hash-change support?
- How do shared default-proxy polling fields behave with multiple applications
  constructed, started, and stopped in different orders?
- Is rerunning an externally retained application after `destroy()` relied upon
  or merely possible?

## Characterization-Test Candidates

Priority should go to behavior spanning lifecycle transitions rather than
behavior already exercised within a single running period:

Issue #8 now covers an ordinary restart after the initial `run()` completes:
the registered route remains available and executes once during each run. This
does not resolve the unusual initial-dispatch case or listener accumulation.
**Covered by test:**
[`test/application_spec.js`](../test/application_spec.js#L316-L350).

1. Calling `unload()` during initial route dispatch before `run()` returns.
2. Internal listener accumulation across repeated restart cycles.
3. Window `unload` handler accumulation across repeated restart cycles.
4. Removal of unrelated submit handlers during `unload()`.
5. `run` event ordering relative to `_running` and listener registration.
6. Location-proxy replacement before startup and while running.
7. Default-proxy restart behavior without native hash-change support.
8. Behavior of externally retained references after `destroy()`.

These candidates record uncertainty or unprotected behavior; they do not imply
that the current implementation is defective.
