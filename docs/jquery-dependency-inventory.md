# jQuery Dependency Inventory

## Scope and Evidence

This document inventories how the current Sammy source depends on jQuery. It
distinguishes loader requirements, internal implementation calls, observable
behavior shaped by jQuery, public jQuery-shaped interfaces, plugin-local use,
and test or example use. It does not recommend replacements or claim that a
particular newer jQuery release is compatible.

Primary runtime evidence is `lib/sammy.js` and every file in `lib/plugins/`.
Generated files in `lib/min/` and historical copies under `examples/` are not
counted as separate implementations. Existing tests establish coverage only
for the behavior they exercise.

Evidence is classified as follows:

- **Observed from source:** directly follows from the current implementation.
- **Covered by tests:** an existing assertion exercises the stated behavior.
- **Weakly covered:** the containing feature is exercised, but the particular
  jQuery semantic is not isolated by a focused assertion.
- **Unresolved:** current source and tests do not establish a meaningful stable
  compatibility contract.
- **Characterization candidate:** observable, compatibility-sensitive behavior
  worth protecting before its implementation changes.

These labels describe evidence, not original intent. A dependency or coverage
gap is not, by itself, a defect.

## Current jQuery Loading and Version

### Declared dependency metadata

`bower.json` declares `jquery: ">=1.4.1"`, and the README says to load Sammy
after jQuery and repeats that minimum. The changelog records both the adoption
of that minimum and the historical reliance on submit bubbling in jQuery 1.4.1.
**Documented historical compatibility claim:** [`bower.json`](../bower.json#L22-L24),
[`README.md`](../README.md#L9-L18), [`README.md`](../README.md#L58-L61), and
[`HISTORY.md`](../HISTORY.md#L319-L325).

The current `package.json` points its package entry at `lib/sammy.js` but does
not declare jQuery as a runtime dependency. It contains the modern test command
and Puppeteer as a development dependency. This is a metadata fact, not
evidence that Sammy runs without jQuery. **Observed from metadata:**
[`package.json`](../package.json).

### Source-implied API floors

The declared `>=1.4.1` range does not describe every current source path's API
requirements. Core pushState link handling calls jQuery `.delegate()` and
`.undelegate()`, whose applicable signatures were added in jQuery 1.4.2. That
conditional branch cannot execute as written with jQuery 1.4.1. The optional
`PushLocationProxy` calls `.on()` and `.off()`, which were added in jQuery 1.7.
**Observed from source and jQuery documentation:**
[`DefaultLocationProxy`](../lib/sammy.js#L284-L327),
[`PushLocationProxy`](../lib/plugins/sammy.push_location_proxy.js#L32-L51),
[`.delegate()`](https://api.jquery.com/delegate/),
[`.undelegate()`](https://api.jquery.com/undelegate/),
[`.on()`](https://api.jquery.com/on/), and
[`.off()`](https://api.jquery.com/off/).

These facts do not establish one replacement minimum for the whole package.
Core delegation is conditional on History API availability and the
`disable_push_state` setting, while `PushLocationProxy` is optional and is not
loaded by the authoritative suite. They do establish that package metadata,
individual source-path requirements, optional-plugin requirements, and the
tested version are divergent evidence. The historical package-level minimum
must not be treated as a uniform source-derived compatibility floor.

### Runtime loader boundary

Core Sammy supports two source-observed loading paths:

- An AMD loader receives an anonymous module with `jquery` as its dependency.
- A plain script expects global `jQuery`, passes it into the factory, and
  publishes the result as both `window.Sammy` and `jQuery.sammy`.

The factory parameter `$` is therefore required before any core implementation
executes. There is no separate CommonJS branch in this source wrapper.
**Observed from source:** [`lib/sammy.js`](../lib/sammy.js#L5-L15).

Every first-party plugin likewise declares `jquery` and `sammy` in its AMD
wrapper and passes `window.jQuery` and `window.Sammy` in its plain-script path.
That loader dependency exists even for plugins whose factory body makes no
direct jQuery call.

### Vendored test version

The authoritative browser page loads `vendor/jquery.js` before Mocha, Sammy,
plugins, or specs. That file identifies itself as jQuery 1.7.2. The page's AMD
mock maps `jquery` to `window.jQuery`, and a jQuery ready callback starts Mocha.
**Observed from source:** [`vendor/jquery.js`](../vendor/jquery.js#L1-L14) and
[`test/index.html`](../test/index.html#L10-L42),
[`test/index.html`](../test/index.html#L90-L94).

The 380-passing, 0-failing, 4-pending baseline therefore establishes current
suite behavior with the vendored jQuery 1.7.2 and the plugins loaded by
`test/index.html`. It does not prove that 1.7.2 is Sammy's intended minimum, that
all releases satisfying `>=1.4.1` work, or that unlisted plugins are compatible.

## Dependency Types

The inventory uses these independent classifications:

| Type | Meaning |
| --- | --- |
| Loader | jQuery is required to construct or publish the module. |
| Internal runtime | Sammy calls a jQuery API without directly exposing its value. |
| Behavioral | jQuery semantics affect routing, lifecycle, rendering, parameters, or other observable behavior. |
| Public API/type | Sammy accepts, returns, or exposes a jQuery object or convention. |
| Plugin-local | The dependency is contained within one optional integration. |
| Test-only | The legacy test page or specs use jQuery independently of runtime code. |
| Example-only | An example demonstrates a consumer-side integration pattern. |

Replacement difficulty is intentionally not assigned. “Internal” does not
mean trivial to replace, and “public” does not prove that every incidental
jQuery property is a promised compatibility contract.

## Core Runtime Dependencies

| Area | jQuery API or semantic | Boundary and observable effect | Evidence status |
| --- | --- | --- | --- |
| Module loading | AMD `jquery`; global `jQuery`; `jQuery.sammy` | Loader and public namespace. Sammy cannot construct through either supported path without jQuery. | Observed from source; AMD registration covered, plain-script branch not directly exercised by the authoritative suite. |
| Object composition | `$.extend()` | Builds the `Sammy` namespace and several prototypes; shallow-copies values into `Sammy.Object`, route parameters, options, and redirect parameters. | Observed; many results covered, but jQuery merge semantics are not isolated everywhere. |
| Collection utilities | `$.each()`, `$.inArray()`, `$.isEmptyObject()`, `$.trim()` | Iterates plugins, listeners, routes, filters, render data, and object properties; supports option matching and value checks. | Internal runtime use; feature behavior is broadly but not API-by-API covered. |
| Element access | `$()`, `.find()` | `Application.$element()` selects the application element and optionally finds descendants. | Public return type; widely exercised, but its jQuery return shape is not isolated by a focused assertion. |
| Application events | `.bind()`, `.unbind()`, `.trigger()` and event namespaces | Sammy stores listeners, binds them to the application element while running, emits namespaced DOM events, and supplies jQuery event objects plus a second data argument. | Behavioral and public callback surface; covered by event and lifecycle tests. |
| Browser navigation | Window `.bind()`/`.unbind()`, document `.delegate()`/`.undelegate()`, synthetic `.trigger()` | Hashchange, popstate, delegated link clicks, and polling notifications feed `location-changed` and route dispatch. | Behavioral; location paths are covered, individual jQuery semantics are partly implicit. |
| Event decisions | `e.isDefaultPrevented()`, `e.target`, modifier properties, `.closest()`, `.attr()` | Existing prevention, modifier keys, link/form targets, and nearest relevant element determine whether Sammy intercepts a browser action. | Behavioral and callback/event surface; partly covered by form and location tests. |
| Startup and cleanup | Window unload binding and element/event unbinding | `run()` installs browser and application bindings; `unload()` removes selected namespaced listeners and delegated handlers. | Behavioral; lifecycle tests cover major effects, not every native/jQuery interaction. |
| Forms | `$()`, `.find()`, `.val()`, `.attr()`, `.get()`, `.serializeArray()` | Method override lookup, action discovery, successful-control serialization, route parameters, and `EventContext.target` depend on jQuery DOM/form conventions. | Behavioral and public context surface; focused form tests cover common cases. |
| Rendering and DOM mutation | `.html()`, `.append()`, `.prepend()` and jQuery selection | `swap()`, `appendTo()`, `prependTo()`, and `replace()` mutate selected DOM nodes; `swap()` returns the jQuery collection. | Behavioral and public return surface; covered by render tests. |
| Template input | jQuery object shape, `.attr()`, `.remove()`, indexed DOM node access | `RenderContext.load()` accepts a DOM or jQuery object, detects the latter through `location.selector`, reads `data-engine`, and optionally removes the source node. | Public input/type coupling; DOM/jQuery and `clone: false` paths covered by tests. |
| Render collection | `returned.jquery` and indexed element access | `collect()` recognizes one-element jQuery results and converts them to DOM nodes rather than joining them as strings. | Public callback-result convention; weakly covered. |
| Remote loading | `$.ajax()` plus `$.extend()` option merging | `RenderContext.load(path, options)` removes Sammy-only options, combines defaults with remaining caller options, and passes them to `$.ajax()`. | Public pass-through and behavioral dependency; loading/caching covered, arbitrary option pass-through weakly covered. |
| JSON | `$.parseJSON()` | `EventContext.json()` delegates default parsing to jQuery unless a plugin overrides it. | Public helper behavior; covered by context/plugin tests. |

Primary source ranges are [`Sammy.Object`](../lib/sammy.js#L125-L214),
[`Application.$element()`](../lib/sammy.js#L410-L457),
[`bind()` and `trigger()`](../lib/sammy.js#L677-L729),
[`run()` and `unload()`](../lib/sammy.js#L955-L1034),
[`runRoute()`](../lib/sammy.js#L1102-L1199),
[form handling](../lib/sammy.js#L1396-L1452),
[listener binding](../lib/sammy.js#L1482-L1488),
[`RenderContext`](../lib/sammy.js#L1510-L1923), and
[`EventContext`](../lib/sammy.js#L1958-L2145).

## Event-System Compatibility Surface

Sammy application events are jQuery events attached to the application's DOM
element, not a separate internal emitter. `bind(name, callback)` wraps the
callback, stores it, and—once running—binds `name.<application namespace>`.
`trigger(name, data)` triggers that namespaced name with `[data]`, causing the
wrapper to receive a jQuery event first and the payload second. The wrapper
reads `e.type` and `e.target`, assigns `e.cleaned_type`, and selects or creates
the `EventContext`. **Observed from source:**
[`lib/sammy.js`](../lib/sammy.js#L671-L729),
[`lib/sammy.js`](../lib/sammy.js#L1482-L1488).

The default location proxy adds further jQuery semantics:

- hashchange and popstate handlers are namespaced per application;
- pushState link interception uses delegated document clicks;
- a handler honors `isDefaultPrevented()`, Meta, and Ctrl state;
- target-window checks traverse from `event.target` with `.closest()`;
- the polling fallback synthesizes hashchange with a second `true` argument so
  the handler can distinguish it from a native notification; and
- unbinding relies on matching event names and delegated selectors.

These behaviors participate directly in route dispatch. **Observed from
source:** [`targetIsThisWindow()`](../lib/sammy.js#L218-L229) and
[`DefaultLocationProxy`](../lib/sammy.js#L271-L373). Existing location tests
cover native/polled notification, pushState links, and cleanup, but do not form
a compatibility matrix across jQuery releases:
[`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L1-L190).

Form interception also relies on delegated/bubbling event behavior. The
historical changelog explicitly associates automatic post/put/delete form
handling with submit bubbling in jQuery 1.4.1. Current tests exercise existing
and subsequently added forms, target-window exclusion, method overrides, GET
location changes, encoding, and non-GET dispatch. **Documented history and test
coverage:** [`HISTORY.md`](../HISTORY.md#L319-L325) and
[`test/application_spec.js`](../test/application_spec.js#L335-L536).

## Public jQuery-Shaped Interfaces

The following boundaries are stronger than incidental internal calls:

- The plain-script loader publishes the top-level application lookup/creation
  function as `jQuery.sammy` (normally used as `$.sammy(...)`) as well as
  `window.Sammy`.
- `Application.$element(selector)` returns a jQuery collection. With a selector
  it returns `.find(selector)` beneath the application element.
- `EventContext.$element(selector)` exposes the same result through the route or
  event context.
- `Application.swap()` calls `.html(content)` and returns that jQuery
  collection; custom swap implementations are also documented in jQuery terms.
- Application event callbacks receive a jQuery event object. Sammy behavior
  reads its type, target, prevention state, and modifier-key properties.
- `RenderContext.load()` accepts a DOM element or a value recognized as a
  jQuery object by its shape. The jQuery path uses `.attr()`, `.remove()`,
  `.selector`, and indexed element access.
- `RenderContext.collect()` recognizes callback results through the `.jquery`
  marker, `.length`, and indexed element access.
- Render placement methods accept jQuery-compatible selector input and inherit
  the mutation semantics of `.append()`, `.prepend()`, and `.html()`.
- Core form handling accepts jQuery-wrapped forms internally, and route
  callbacks receive the underlying form DOM node as `EventContext.target` for
  non-GET submissions.

**Observed from source:** [module publication](../lib/sammy.js#L5-L15),
[`Application.$element()`](../lib/sammy.js#L455-L457),
[`Application.swap()`](../lib/sammy.js#L1312-L1339),
[`RenderContext.load()`](../lib/sammy.js#L1616-L1691),
[`RenderContext.collect()`](../lib/sammy.js#L1802-L1825),
[render placement](../lib/sammy.js#L1884-L1911), and
[`EventContext.$element()`](../lib/sammy.js#L1966-L1971).

Tests explicitly cover loading jQuery and DOM objects, destructive
`clone: false` loading, DOM placement, form targets, and common event paths:
[`test/render_context_spec.js`](../test/render_context_spec.js#L23-L136),
[`test/render_context_spec.js`](../test/render_context_spec.js#L222-L480), and
[`test/application_spec.js`](../test/application_spec.js#L225-L536).

## AJAX Option Pass-Through

Remote `RenderContext.load()` is not merely an internal use of `$.ajax()`.
Callers may supply `options`; Sammy shallow-copies them, consumes `cache`,
`json`, and `engine`, then merges the remaining properties over its defaults
before calling `$.ajax()`. Consequently, the public loading API inherits an
open-ended subset of jQuery AJAX option semantics. The source does not define
or constrain every option that jQuery accepts, so this inventory does not try
to enumerate them. **Observed from source:**
[`lib/sammy.js`](../lib/sammy.js#L1637-L1675).

The suite wraps `jQuery.ajax` and covers remote loading, data type selection,
and Sammy's cache decisions. It does not appear to isolate the general
caller-option pass-through contract. **Covered and weakly covered:**
[`test/render_context_spec.js`](../test/render_context_spec.js#L1-L8),
[`test/render_context_spec.js`](../test/render_context_spec.js#L90-L220).

## Plugin Dependency Matrix

All 26 first-party plugin files have a loader dependency on jQuery: their AMD
wrappers request `jquery`, and their plain-script paths pass `window.jQuery`.
“Direct coupling” below describes the factory body beyond that wrapper.
“Focused tests” means the suite contains tests for that plugin, not that every
listed jQuery semantic has an isolated assertion.

For plugins loaded by `test/index.html`, the authoritative suite exercises the
AMD wrapper path through its mock loader. The corresponding plain-script global
wrapper paths are not independently characterized.

| Plugin | Loader inputs | Direct jQuery coupling | Other dependency or boundary | Authoritative suite / focused tests |
| --- | --- | --- | --- | --- |
| [`sammy.cache.js`](../lib/plugins/sammy.cache.js) | jQuery, Sammy | `extend`, `each`, `isFunction`; `DataCacheProxy` accepts and stores a jQuery collection and uses `data`/`removeData` | Deprecated cache interface | Yes / Yes |
| [`sammy.data_location_proxy.js`](../lib/plugins/sammy.data_location_proxy.js) | jQuery, Sammy | `extend`; application-element `bind`, `delegate`, `undelegate`, `unbind`, `data`, `each`; static `$.data`; attribute lookup | jQuery data/event ordering affects location dispatch | Yes / Yes, in location-proxy specs |
| [`sammy.ejs.js`](../lib/plugins/sammy.ejs.js) | jQuery, Sammy, EJS | None beyond loader | EJS rendering API | Yes / Yes |
| [`sammy.exceptional.js`](../lib/plugins/sammy.exceptional.js) | jQuery, Sammy | None beyond loader; uses Sammy's event API | Global/hosted Exceptional client | Yes / Yes |
| [`sammy.flash.js`](../lib/plugins/sammy.flash.js) | jQuery, Sammy | `extend` for `FlashHash` | Uses Sammy redirect/event behavior | Yes / Yes |
| [`sammy.form_2_json.js`](../lib/plugins/sammy.form_2_json.js) | jQuery, Sammy | None beyond loader; implementation traverses DOM forms directly | Public form-to-object helper | No / No |
| [`sammy.form.js`](../lib/plugins/sammy.form.js) | jQuery, Sammy | `extend`, `each`, `isArray`, `isFunction` | Generated HTML and attribute/function conventions | Yes / Yes |
| [`sammy.googleanalytics.js`](../lib/plugins/sammy.googleanalytics.js) | jQuery, Sammy | None beyond loader; uses Sammy's after event | `_gaq`/Google Analytics global | No / No |
| [`sammy.haml.js`](../lib/plugins/sammy.haml.js) | jQuery, Sammy, Haml AMD entry | `extend` merges context and data | Haml engine | Yes / Yes |
| [`sammy.handlebars.js`](../lib/plugins/sammy.handlebars.js) | jQuery, Sammy, Handlebars | `extend` merges context, data, and partials | Handlebars engine | Yes / Yes |
| [`sammy.hogan.js`](../lib/plugins/sammy.hogan.js) | jQuery, Sammy, Hogan | `extend` merges context, data, and partials | Hogan engine | Yes / Yes |
| [`sammy.hoptoad.js`](../lib/plugins/sammy.hoptoad.js) | jQuery, Sammy | None beyond loader; uses Sammy's event API | Hoptoad notifier global | Yes / Yes |
| [`sammy.json.js`](../lib/plugins/sammy.json.js) | jQuery, Sammy | None beyond loader | Bundled JSON implementation overrides the core helper | Yes / Yes |
| [`sammy.kissmetrics.js`](../lib/plugins/sammy.kissmetrics.js) | jQuery, Sammy | None beyond loader; uses Sammy's after event | `_kmq` global | No / No |
| [`sammy.meld.js`](../lib/plugins/sammy.meld.js) | jQuery, Sammy | Extensive DOM selection, filtering, traversal, cloning, creation, mutation, collection indexing/splicing, `each`, `extend`, `isArray` | Accepts DOM/jQuery-like template input | Yes / Yes |
| [`sammy.mixpanel.js`](../lib/plugins/sammy.mixpanel.js) | jQuery, Sammy | None beyond loader; uses Sammy's after event | `mixpanel` global | No / No |
| [`sammy.mustache.js`](../lib/plugins/sammy.mustache.js) | jQuery, Sammy, Mustache | `extend` merges context, data, and partials | Mustache engine | Yes / Yes |
| [`sammy.nested_params.js`](../lib/plugins/sammy.nested_params.js) | jQuery, Sammy | `isArray`; deep `extend(true, ...)` builds nested parameter structures | Changes form/query parameter grammar | Yes / Yes |
| [`sammy.oauth2.js`](../lib/plugins/sammy.oauth2.js) | jQuery, Sammy | Global `$(document).ajaxSend()` hook | Injects an OAuth header into jQuery AJAX requests; uses Sammy events/routes | Yes / Yes |
| [`sammy.path_location_proxy.js`](../lib/plugins/sammy.path_location_proxy.js) | jQuery, Sammy | `extend` for its prototype | Browser `window.location` | No / No |
| [`sammy.pure.js`](../lib/plugins/sammy.pure.js) | jQuery, Sammy, Pure | Wraps a template with `$()` and calls the jQuery plugin method `autoRender()` | Pure integration augments `jQuery.fn` | Yes / Yes |
| [`sammy.push_location_proxy.js`](../lib/plugins/sammy.push_location_proxy.js) | jQuery, Sammy | `extend`; window `bind`/`unbind`; element `on`/`off`; selection and `attr` | Alternate history and delegated-click proxy | No / No |
| [`sammy.storage.js`](../lib/plugins/sammy.storage.js) | jQuery, Sammy | Selection; `extend`, `each`, `isArray`, `isFunction`, `inArray`; `trigger`; `get`; `data`/`removeData` | Public stores, KVO-style events, AJAX-backed load, Web Storage, cookies | Yes / Yes |
| [`sammy.template.js`](../lib/plugins/sammy.template.js) | jQuery, Sammy | `extend` merges context and render data | Built-in template compiler | Yes / Yes |
| [`sammy.title.js`](../lib/plugins/sammy.title.js) | jQuery, Sammy | `isFunction`, `makeArray` | `document.title` | No / No |
| [`sammy.tmpl.js`](../lib/plugins/sammy.tmpl.js) | jQuery, Sammy, jquery.tmpl | `$.template`, `$.tmpl`, and `extend`; returns jquery.tmpl output | Requires the separate jQuery Templates plugin | Yes / Yes |

Wrapper and direct-call evidence spans [`lib/plugins/`](../lib/plugins/).
The loaded subset is explicit in [`test/index.html`](../test/index.html#L44-L78),
with focused plugin groups in [`test/plugins_spec.js`](../test/plugins_spec.js),
[`test/storage_spec.js`](../test/storage_spec.js),
[`test/meld_spec.js`](../test/meld_spec.js),
[`test/flash_spec.js`](../test/flash_spec.js),
[`test/exceptional_spec.js`](../test/exceptional_spec.js), and
[`test/hoptoad_spec.js`](../test/hoptoad_spec.js).

## High-Sensitivity Plugin Cases

### `Sammy.DataLocationProxy`

This proxy uses jQuery DOM data as its location store and jQuery events as its
notification mechanism. Its `setData` handler contains an explicit ordering
assumption: jQuery fires the event before storing the new value, so the handler
uses static `$.data()` to set the value on each application element before
triggering `location-changed`. It also delegates clicks on a configurable
attribute and reads the destination through jQuery. This is a behavioral
dependency, not merely use of a data convenience method. **Observed from
source:** [`lib/plugins/sammy.data_location_proxy.js`](../lib/plugins/sammy.data_location_proxy.js#L43-L80).

The changelog records an earlier repair following a change in how jQuery fired
`setData`. Current tests cover reading, setting, binding, unbinding, and
location notification, but do not compare versions. **Historical evidence and
coverage:** [`HISTORY.md`](../HISTORY.md#L244-L253) and
[`test/location_proxy_spec.js`](../test/location_proxy_spec.js#L201-L256).

### Storage and cache

`Sammy.Store` creates and publicly retains `this.$element`, fires KVO-style
jQuery events with object payloads, can load values through `$.get()`, and
offers a `data` backend implemented directly with jQuery DOM data. The
deprecated cache plugin similarly passes `app.$element()` into a
`DataCacheProxy`. Consumers can observe the element property and set events, so
these dependencies cross plugin API and event boundaries. **Observed from
source:** [`lib/plugins/sammy.storage.js`](../lib/plugins/sammy.storage.js#L52-L116),
[`lib/plugins/sammy.storage.js`](../lib/plugins/sammy.storage.js#L231-L265),
[`lib/plugins/sammy.storage.js`](../lib/plugins/sammy.storage.js#L300-L322), and
[`lib/plugins/sammy.cache.js`](../lib/plugins/sammy.cache.js#L30-L70).

Storage tests cover each backend, KVO payloads, and remote loading. They protect
common outcomes but do not separately specify all jQuery data or AJAX
semantics: [`test/storage_spec.js`](../test/storage_spec.js#L76-L234).

### Templating adapters

The adapters have materially different coupling despite sharing similar
wrappers:

- EJS makes no direct jQuery call after its loader wrapper.
- Template, Haml, Mustache, Hogan, and Handlebars primarily use `$.extend()` to
  combine an `EventContext` with render data or partials.
- Meld implements its transformation through jQuery collection traversal and
  mutation and accepts DOM/jQuery-like input.
- Pure relies on the external engine installing `autoRender()` on a jQuery
  collection.
- Tmpl calls the external `$.template` and `$.tmpl` APIs and returns their
  output.

Consequently, “template plugin uses jQuery” does not identify whether jQuery is
only a loader input, a merge utility, the DOM transformation engine, or the
host for another plugin's public API.

### OAuth2 AJAX hook

Installing `Sammy.OAuth2` binds a handler with `$(document).ajaxSend()`. When an
access token exists, the handler adds an Authorization header to jQuery AJAX
requests. The suite simulates `ajaxSend` and covers the header, but the source
does not retain or remove the installed handler. This inventory records that
lifecycle-sensitive coupling without deciding whether it should change.
**Observed and covered:** [`lib/plugins/sammy.oauth2.js`](../lib/plugins/sammy.oauth2.js#L89-L106)
and [`test/plugins_spec.js`](../test/plugins_spec.js#L848-L864).

### Alternate location proxies

`PathLocationProxy` uses only `$.extend()` beyond its wrapper and is not loaded
by the authoritative suite. `PushLocationProxy` additionally uses jQuery window
events, `on`/`off` on the application element, selector-based delegated clicks,
and link attribute lookup. Its `on`/`off` calls imply a jQuery 1.7-or-newer API
dependency for that plugin path, without implying the same floor for Sammy as
a whole. The plugin is not loaded by the authoritative suite, so the Bower
range and a passing core/default-proxy baseline do not establish its runtime
compatibility. **Observed from source and jQuery documentation:**
[`lib/plugins/sammy.path_location_proxy.js`](../lib/plugins/sammy.path_location_proxy.js)
and [`lib/plugins/sammy.push_location_proxy.js`](../lib/plugins/sammy.push_location_proxy.js),
with API-version evidence from [`.on()`](https://api.jquery.com/on/) and
[`.off()`](https://api.jquery.com/off/).

## Test and Example Dependencies

Three test relationships must remain separate:

1. **Runtime under test:** core and loaded plugins require the same jQuery 1.7.2
   instance supplied by the page.
2. **Harness:** `test/index.html` itself loads jQuery, maps it through the AMD
   test shim, and uses its ready callback to start Mocha.
3. **Specs:** tests use `$()` for fixture setup and assertions, trigger and bind
   jQuery events, submit forms, inspect DOM data, and wrap `jQuery.ajax`.

A failure after changing jQuery could therefore arise from Sammy behavior, an
optional plugin, test setup, or the runner page. The baseline alone would not
identify which layer changed.

Examples demonstrate consumer-facing patterns such as `$.sammy(...)`, jQuery
document ready, DOM manipulation inside routes, and jQuery AJAX followed by a
route's `next()`: [`README.md`](../README.md#L14-L56). Copies of Sammy or jQuery
inside examples are historical distribution artifacts and are not additional
first-party implementations for this inventory.

## Constraints for Future Modernization

- jQuery is a current loader prerequisite, not just a collection of utility
  helpers used after initialization.
- Event binding, namespacing, payloads, prevention, delegation, and cleanup
  shape core routing and lifecycle behavior.
- `$element()`, event callbacks, rendering inputs/results, and some plugin
  properties cross public boundaries with jQuery-specific types or shapes.
- Form serialization influences observable route parameters and successful
  control handling.
- `RenderContext.load()` exposes jQuery AJAX behavior indirectly by passing
  caller options through to `$.ajax()`.
- Direct DOM and data coupling is concentrated in core rendering/navigation and
  a smaller set of plugins, especially Meld, DataLocationProxy, Storage, Cache,
  Pure, Tmpl, OAuth2, and PushLocationProxy.
- Many other plugins have only a loader dependency or use jQuery for object
  merging; these are different dependency shapes even though all receive `$`.
- The historical minimum, the vendored test version, and current tested
  compatibility are separate facts and must remain separate in future
  decisions.
- Core and optional-plugin source paths already imply different API floors, so
  no single minimum should be inferred from package metadata alone.
- Unloaded plugins require their own evidence before a jQuery change can be
  described as compatible across the full first-party plugin set.

These are constraints and evidence, not a proposed migration sequence.

## Unresolved Questions

- Which versions above the historical `>=1.4.1` declaration preserve all
  current core, plugin, and harness behavior?
- Which jQuery object details exposed by public methods are relied upon by real
  consumers beyond the documented collection behavior?
- Is `RenderContext.load()` detection through `location.selector` intended as
  a stable contract, or only an implementation detail of the vendored jQuery?
- Which caller-supplied jQuery AJAX options have historically been used through
  `RenderContext.load()`?
- Do consumers rely on exact jQuery event fields, propagation, namespace, or
  handler-removal semantics beyond those covered by current tests?
- What compatibility expectations apply to the seven plugins not loaded by the
  authoritative suite?
- Was the historical package-level `>=1.4.1` claim intended to apply uniformly
  to every optional first-party plugin, or primarily to core Sammy?
- Should npm metadata eventually express jQuery as a runtime or peer
  dependency? This inventory establishes the missing declaration but does not
  choose a packaging policy.

## Characterization-Test Candidates

These candidates are limited to jQuery semantics that materially affect an
observable Sammy boundary:

- namespaced application-event isolation and cleanup across multiple apps;
- delegated link/form handling, prior `preventDefault()`, modifier keys, target
  windows, and dynamically inserted forms;
- `DataLocationProxy` data/event ordering and notification cleanup;
- `Application.$element()` and `EventContext.$element()` return behavior;
- `RenderContext.load()` with jQuery inputs, including `clone: false`;
- caller AJAX options passed through `RenderContext.load()`;
- form serialization cases that alter route parameter values;
- jQuery-valued input/output exposed by Meld, Pure, Tmpl, Storage, and Cache;
- installation and cleanup behavior of OAuth2's global AJAX hook; and
- PushLocationProxy event installation/removal, since it is outside the current
  authoritative suite.

Existing tests already cover parts of several candidates. Future work should
first identify the missing observable assertion rather than duplicate broad
feature coverage. No candidate here is a confirmed defect.

## Evidence Index

- Dependency metadata: [`bower.json`](../bower.json),
  [`package.json`](../package.json), [`README.md`](../README.md), and
  [`HISTORY.md`](../HISTORY.md).
- Core implementation: [`lib/sammy.js`](../lib/sammy.js).
- Optional integrations: [`lib/plugins/`](../lib/plugins/).
- Authoritative suite composition: [`test/index.html`](../test/index.html).
- Core application/event/form behavior:
  [`test/application_spec.js`](../test/application_spec.js).
- Default and data-backed location behavior:
  [`test/location_proxy_spec.js`](../test/location_proxy_spec.js).
- Rendering, jQuery input, AJAX, and DOM placement:
  [`test/render_context_spec.js`](../test/render_context_spec.js).
- Plugin behavior: [`test/plugins_spec.js`](../test/plugins_spec.js),
  [`test/storage_spec.js`](../test/storage_spec.js), and the focused plugin
  specs loaded by `test/index.html`.
