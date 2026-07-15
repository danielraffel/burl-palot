# Live React versus baked DesignIR A/B experiment

> **Paused decision point (2026-07-15):** Read
> [`docs/handoffs/2026-07-15-palot-import-approach-decision.md`](handoffs/2026-07-15-palot-import-approach-decision.md)
> before resuming. It records both preserved approaches, exact commits, red
> gates, and the recommended hybrid decision test. Do not infer a direction
> without asking the user.

## Purpose

This experiment evaluates the existing Pulp/Burl live React runtime against the
current observed-DOM and baked DesignIR Palot pilot. It is additive. The baked
pilot, its authoritative visual state, native macOS window material, and its
evidence remain the control; they are not replaced or rewritten by the
experiment.

## Hypothesis

The live React lane should preserve hooks, closures, component state, event
handlers, focus behavior, and overlay lifecycle that are necessarily absent
from a baked UI snapshot. The baked lane may remain the stronger visual oracle.
If each hypothesis is confirmed, the reusable importer should compose them:

- live React owns application behavior and state;
- imported DesignIR owns the reviewed native visual contract;
- a generic typed action and state bridge synchronizes the two;
- Electron-only services terminate at portable host-action interfaces;
- macOS 26 window material remains an optional platform capability beneath the
  portable window-effect interface.

No Palot-specific action identifier or product behavior may land in Burl.

## Fixed inputs

- Palot source: `/Users/danielraffel/Code/palot` (read-only)
- baked control: this repository at the checkpoint preceding the experiment
- framework control: the pinned Burl checkpoint used by the baked control
- viewport cohort: the same wide, reference, minimum-supported, and compact
  sizes for both lanes
- theme, fonts, project fixture, session fixture, and macOS appearance: fixed
  across both lanes

## Required receipts

Each lane must run the same scripted matrix and emit state plus screenshots for:

1. sidebar collapse and restore;
2. settings navigation and Back to app;
3. theme segmented control, opaque-background switch, and display-mode select;
4. model and variant menus using pointer, Escape, arrows, Enter, and outside click;
5. tooltips with delayed open and prompt dismissal on pointer leave;
6. title editing, commit, cancel, and stable toolbar geometry;
7. changes panel open, file selection, load completion, and close;
8. composer focus, typing, IME, submit, cancel, retry, selection, and clipboard;
9. scrolling and bottom anchoring through window resize;
10. a real streamed OpenCode response.

Every receipt records target resolution, down/up delivery, callback execution,
state delta, focus delta, overlay lifecycle, screenshot hash, and failure class.
Compilation or a non-empty PNG is not a pass.

## Decision rule

Adopt the live lane only for capabilities it proves. Reuse visual, responsive,
typographic, icon, platform-material, and accessibility work from the baked
pilot whenever it remains stronger. A hybrid is accepted only through generic
framework contracts with a held-out React fixture; consumer-only patches do not
count as importer progress.
