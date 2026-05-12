# Scripture Module Roadmap

> Living document. Update after each session. Strike through completed items. Add new discoveries as they come.

---

## Current State (v1.2)

The scripture widget system is stable and feature-complete for its core use cases. All supported widget types render correctly, emit events, and animate smoothly.

### What's solid

| Category | Widgets | Status |
| --- | --- | --- |
| **Display** | stat, bar, counter, progress, taggroup, divider, icon, badge, text, panel | Complete |
| **Interactive** | button, toggle, select, slider, input, textarea, radio, stepper, confirm, chipselect | Complete |
| **Containers** | accordion, tabs, dropdown, sortable | Complete |
| **Custom** | HTML injection (tables, lists, code, images, grids) with CSP-safe sanitization | Complete |
| **Animation** | Value tweening, bar/progress width transitions, entrance/exit animations | Complete |

### Test coverage

All scenarios in the test suite are functional:

- `/scripture display` — Display widget baseline
- `/scripture interactive` — Event emission verification
- `/scripture containers` — Expand/collapse, tabs, reorder
- `/scripture invalid` — Graceful degradation on bad configs
- `/scripture transitions` — Animated value changes across turns
- `/scripture edge` — Boundary conditions (empty lists, 0-width bars, etc.)
- `/scripture custom` — Static HTML rendering with sanitizer
- `/scripture panels` — Panel layout with items and content

---

## Short-term (next 1–2 sessions)

These are the highest-impact items that build on existing infrastructure.

### 1. Accessibility pass

Right now interactive widgets are mouse/touch only. A keyboard user cannot operate the slider, stepper, radio group, or sortable list.

- [ ] Add `tabindex` and focus rings to all interactive widgets
- [ ] Implement keyboard handlers: `Enter`/`Space` for buttons/toggles, arrow keys for stepper/slider/radio, `Escape` for dropdowns/accordions
- [ ] Add ARIA roles: `role="button"`, `role="tab"`, `role="slider"`, `aria-expanded`, `aria-selected`, `aria-label`
- [ ] Ensure focus order follows visual order (especially for sortable)

**Why:** Real users don't always have a mouse. AI Dungeon is keyboard-heavy already.

### 2. Widget group layouts / rows

Currently every widget is an independent block. There's no way to place HP + MP + Shield in a single horizontal row.

- [ ] Add a `group` or `row` container type that accepts `widgets: [...]` as children
- [ ] CSS: `display: flex; flex-direction: row; gap: 6px;` with wrap behavior
- [ ] Support `align` per child within the group (or inherit from group)

**Why:** Horizontal stat bars are a staple of RPG UIs. The current vertical stacking wastes horizontal space.

### 3. Deeper invalid-config testing

The `invalid` scenario only covers 3 broken configs. We should stress-test validation more thoroughly.

- [ ] Duplicate widget IDs
- [ ] Missing required fields per widget type
- [ ] Unknown color presets
- [ ] Invalid `align` values
- [ ] `items` array with malformed entries (missing `label`, wrong `type`)
- [ ] Oversized values that break layout
- [ ] Circular references in container children (if we add nesting)

**Why:** Catches renderer crashes before they reach users. The sanitizer and validator are the first line of defense.

---

## Medium-term (next 3–5 sessions)

### 4. Responsive density system

The current density system (`recalculateWidgetDensity`) toggles a single `bd-dense` class. A more granular approach would adapt to both screen width and widget count.

- [ ] Track widget count per zone (left/center/right)
- [ ] Auto-hide labels on stat/bar widgets when >N widgets present
- [ ] Shrink padding/gaps progressively as count increases
- [ ] Single-column mode when zone width < 240px

**Why:** AI Dungeon's sidebar is narrow. Dense scenarios (all 8 scenarios at once) currently overflow or look cramped.

### 5. Conditional / dynamic visibility

Allow widgets to show/hide based on other widget values.

- [ ] Add `visible` or `condition` field to widget config (e.g., `visible: "hp < 20"`)
- [ ] Parse simple expressions in `validators.js`
- [ ] Renderer evaluates conditions each turn before rendering
- [ ] Hidden widgets animate out, revealed widgets animate in

**Why:** Reduces visual noise. A "Low HP Warning" badge only needs to exist when HP is actually low.

### 6. Staggered entrance animations

Currently all widgets enter simultaneously. Staggering by index would feel more polished.

- [ ] Add CSS custom property `--bd-enter-delay: calc(var(--index) * 40ms)`
- [ ] Pass index from `createWidget` into the animation delay
- [ ] Cap total delay at ~400ms so it doesn't feel slow

**Why:** Small polish that makes the UI feel alive and responsive.

---

## Long-term (future sprints)

### 7. Preset themes / user customization

- [ ] Extract color tokens into swappable theme CSS files
- [ ] Add a `theme` field to the manifest (e.g., `theme: "dark-fantasy"`, `theme: "scifi-terminal"`)
- [ ] User preference override stored in extension localStorage

**Why:** Not everyone wants purple gradients. The current color system is hardcoded.

### 8. Inline icons for all widget types

Currently only `badge`, `icon`, `counter`, and `taggroup` support icons. Allow any widget to prepend an icon.

- [ ] Add `icon` field to base widget config
- [ ] `createBaseWidget` renders an icon `<span>` when present
- [ ] Consistent sizing and alignment across types

**Why:** Visual scanning is faster than reading text. An icon on a button or stat label improves recognition.

### 9. Drag-and-drop sortable (native)

The current sortable uses up/down arrow buttons. A native drag-and-drop implementation would be more intuitive.

- [ ] Implement `draggable` with `dragstart`, `dragover`, `drop` events
- [ ] Visual drag ghost using the widget's own styling
- [ ] Fallback to arrows on touch devices (drag is mouse-only)

**Why:** User expectation for "sortable" is drag-and-drop. The arrows are functional but not conventional.

---

## Known Limitations (won't fix / platform constraints)

| Limitation | Reason | Workaround |
| --- | --- | --- |
| No inline `<script>` execution | AI Dungeon CSP blocks `unsafe-inline` | Static HTML/CSS only; sanitizer strips scripts |
| No `eval` or `Function()` | Same CSP restriction | Pre-compute values before sending manifest |
| No external image URLs | Mixed content / CSP | Use data URI SVGs or inline CSS shapes |
| No persistent storage in script | AI Dungeon resets `state` per session | Save to `frontier:state:*` cards; BD persists |
| No web fonts | Extension content script can't load external fonts | Use system fonts; rely on CSS styling |

---

## Session Log

| Date | Changes |
| --- | --- |
| 2026-05-11 | Added panel widget test scenario; added entrance/exit animations; stripped all inline script execution; updated `sanitizeHTML` to strip `<script>` and `on*` handlers; updated docs |
| 2026-05-11 | Added custom widget test scenario (tables, lists, code, images, grids); compacted container widgets; improved dividers with gradient fades |
| 2026-05-11 | Added smooth value transitions (`_tweenTextValue`, `_tweenStyleProperty`) for stats, bars, counters, progress |
| Earlier | Core widget system, renderer, validators, all base widget types |

---

## How to use this roadmap

1. Pick a short-term item that sounds fun or useful.
2. Before starting, check the **Session Log** to avoid rehashing completed work.
3. Update this file when you finish — mark items complete, add new discoveries, adjust priorities.
4. If a long-term item suddenly becomes urgent (e.g., a user requests themes), bump it up.
