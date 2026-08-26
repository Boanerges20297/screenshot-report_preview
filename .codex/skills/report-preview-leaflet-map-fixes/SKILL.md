---
name: report-preview-leaflet-map-fixes
description: >
  Use this skill when fixing Report Preview map UX in the screenshot-report_preview
  React/Vite app, especially Leaflet tooltips, popups, polygon clicks, selected
  territory focus, map reset, or any complaint that the map "jumps", requires a
  second click, or has unreadable area tooltip text.
license: MIT
metadata:
  author: Codex
  version: "1.0"
---

# Report Preview Leaflet Map Fixes

This captures the proven path for small Leaflet UX fixes in
`C:\Users\Boanerges\Desktop\Projetos\screenshot-report_preview`.

**Failure pattern:** fixing only the visible symptom misses the actual Leaflet
flow: tooltip/popup HTML often has inline colors, and polygon clicks can trigger
selection state that later runs `fitBounds`, causing a visible map jump before
the popup opens.
**Verified by:** `npm run build` passed after the tooltip contrast and click
focus fixes.

## When to use this

- The user says area tooltips/popups are indistinguishable in light theme.
- A polygon click gives a visual "tranco", jumps the map, or needs a second
  click before the popup appears.
- A map interaction works from the sidebar/search but feels wrong when clicking
  directly on the Leaflet layer.

## Procedure

- [ ] 1. Start in `src/components/OperationalMap.tsx`; grep the full flow:
  `rg -n "fitBounds|setView|flyTo|openPopup|bindPopup|bindTooltip|selectedId|focusTrigger" src`.
- [ ] 2. For unreadable tooltip or popup text, inspect both the inline HTML in
  `OperationalMap.tsx` and the Leaflet overrides in `src/index.css`. Inline
  `style="color:..."` wins unless the CSS override is specific and uses
  `!important`.
- [ ] 3. For click jumps, separate direct map selection from programmatic focus.
  Direct polygon click should call selection and let Leaflet open the popup;
  sidebar/search selection may increment `focusTrigger` to run `fitBounds`.
- [ ] 4. Keep the fix small: prefer changing the shared Leaflet CSS override or
  the existing `FocusSelectedTerritory`/`onSelectTerritory` path over adding a
  new state machine.
- [ ] 5. Validate with `npm run build`. If the symptom is visual or click-order
  sensitive, also test the exact click sequence in the browser.

## Gotchas

- `src/App.tsx` imports `src/App.css` after `src/index.css`, so equal-specificity
  CSS in `App.css` can override global Leaflet styles.
- The big area popup and small hover tooltip are different Leaflet surfaces.
  Fix both when the user says "ambos os tooltips" or sends a screenshot showing
  popup plus tooltip.
- Do not increment `focusTrigger` from a direct map polygon click. That makes the
  selected-area effect call `fitBounds`, producing the jump.
- Search results still need programmatic focus; pass a separate focus callback
  instead of making every selection focus the map.

## What didn't work

- Changing only one inline title color in `OperationalMap.tsx`: it fixed neither
  the popup body nor every tooltip line because other inline colors still won.
- Incrementing `focusTrigger` inside the generic `onSelectTerritory` callback:
  it made direct polygon clicks behave like sidebar clicks and caused the map
  jump before the popup opened.
