# Widget Module Roadmap

Living roadmap for the final V2 Widget pass. Widget is feature-complete;
this document should keep the remaining work narrow, practical, and tied to
real showcase-script needs.

## Current State

The widget system is stable for its core contract:

- scripts publish `ultrascripts:state:widget`
- BetterDungeon renders manifest widgets from live-count history
- interactive widgets write events to `ultrascripts:in:widget`
- scripts acknowledge handled events with `interactions.ackSeq`
- widgets animate value changes, entry, exit, and pending acknowledgements

Supported widget groups:

| Category | Widgets | Status |
|---|---|---|
| Display | stat, bar, counter, progress, taggroup, divider, icon, badge, text, panel, list | Shipped |
| Interactive | button, toggle, select, slider, input, textarea, radio, stepper, confirm, chipselect | Shipped |
| Containers | accordion, tabs, dropdown, sortable | Shipped |
| Custom | static sanitized HTML/CSS | Shipped |

## V2 Polish Priorities

### 1. Responsive Layout Verification

- [ ] Check the preview and live suite at desktop, tablet/narrow, and mobile widths.
- [ ] Verify the automatic single-column mobile layout.
- [ ] Verify `data-density` still compacts crowded widget bars without overlap.
- [ ] Confirm long labels, long values, bars, panels, lists, tabs, dropdowns, inputs, sliders, and sortable rows stay inside the container.
- [ ] Confirm scroll behavior when widgets exceed the automatic max-height.

### 2. Interaction And Ack Confidence

- [ ] Run `/widget interactive` and verify all events appear in `ultrascripts:test:widget`.
- [ ] Confirm pending pulses appear immediately after interaction.
- [ ] Confirm pulses clear after `interactions.ackSeq` advances.
- [ ] Confirm coalesced controls such as slider/input/toggle do not flood the event queue.
- [ ] Confirm event pruning keeps only unacknowledged events.

### 3. Accessibility And Focus Polish

- [ ] Add or verify clear focus rings on all native controls.
- [ ] Ensure button, toggle, select, slider, input, textarea, radio, stepper, confirm, chipselect, dropdown, tabs, and sortable controls are keyboard reachable.
- [ ] Add ARIA attributes only where native semantics are insufficient.
- [ ] Keep focus order aligned with visual order.

### 4. Validation Gaps

- [ ] Expand `/widget invalid` to cover duplicate IDs.
- [ ] Cover missing required fields by widget type.
- [ ] Cover malformed `items` and `options` entries.
- [ ] Cover oversized labels, values, HTML, lists, and option arrays.
- [ ] Confirm invalid widgets are skipped with warnings and valid siblings still render.

### 5. Showcase Readiness

- [ ] Brainiac: status/dashboard widgets feel compact and readable.
- [ ] Statboy: stat bars, counters, panels, and tags are readable on PC and mobile.
- [ ] Chronos V2: time/weather widgets work without crowding the story UI.
- [ ] Public guides and starter templates still match the live helper contract.

## Future Only

Do not start these before V2 unless a showcase script proves a hard need:

- row/group container widgets
- conditional/dynamic visibility expressions
- preset themes or user theme customization
- staggered entrance animations
- native drag-and-drop sortable
- new widget types

## Known Platform Constraints

| Limitation | Reason | Workaround |
|---|---|---|
| No inline `<script>` execution | AI Dungeon CSP blocks inline scripts and the sanitizer strips scripts | Use static HTML/CSS only |
| No `eval` or `Function()` | CSP restriction | Pre-compute values before publishing state |
| External images are fragile | CSP, mixed content, and extension context limits | Prefer data URIs or simple CSS shapes |
| Script responses are turn-bound | AI Dungeon modifiers run on turn boundaries | Read events and ack them on the next modifier pass |

## Session Log

| Date | Changes |
|---|---|
| 2026-06-23 | Added interactive accepted-value bridge, improved the local minimize control, and added suite-side stateful event persistence. |
| 2026-06-23 | Tightened validation for duplicate IDs and malformed item/option arrays; added keyboard/focus/ARIA polish for custom interactive controls; expanded `/widget invalid` coverage. |
| 2026-06-16 | Removed manual layout controls from the V2 roadmap; refocused on automatic responsive behavior, interaction confidence, accessibility, validation, and showcase readiness. |
| 2026-05-11 | Added panel widget test scenario; added entrance/exit animations; stripped inline script execution; updated sanitizer and docs. |
| 2026-05-11 | Added custom widget test scenario; compacted container widgets; improved dividers. |
| 2026-05-11 | Added smooth value transitions for stats, bars, counters, and progress. |
| Earlier | Core widget system, renderer, validators, and base widget types. |
