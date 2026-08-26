# Better Sidebars

Lets you drag a tab to the left/right edge of a pane in the left or right sidebar
to create a new side-by-side column there, the same way dragging to an edge in
the main editor area creates a new column. Dropping in the center of a pane (or
on its tab strip) still just stacks the dragged tab into that pane, unchanged.

The dock's own top row - its topmost tab group, spanning the sidebar's full
width - is exempt: dragging to its left/right edge still only offers
top/bottom (stock behavior), same as before this plugin existed. Columns can
only be created from the second row down. This applies identically to both
sidebars.

## Why this exists / how it works

Obsidian's own tab-drag handler (`Workspace.prototype.onDragLeaf`, private/
undocumented) already builds sidebar splits through the exact same
`Workspace.splitLeaf()` path the main editor area uses - the split mechanism
itself was never restricted. It only *offers* top/bottom as candidate drop
directions in the sidebar; left/right are filtered out of the candidate list
before it reaches `Workspace.getDropDirection()`.

This plugin wraps that one method (`app.workspace.getDropDirection`) and, only
when the drop target lives in the left or right sidebar, strips `"left"` and
`"right"` back out of the excluded-directions list it's called with - so all
four directions become selectable there, exactly as in the main area. It does
not touch anything else: no other method is patched, no custom drag/drop
handling is added, and no CSS is shipped.

Confirmed with this technique on Obsidian 1.12.7. Because it depends on an
undocumented private method, a future Obsidian release could rename or
restructure it, which would make the patch a no-op (sidebar drags would just
fall back to core's current top/bottom-only behavior - this plugin doesn't
turn errors into anything worse) or, in principle, throw. If sidebar dragging
ever looks wrong after an Obsidian update, disable this plugin first to check.

### Restricting columns to the second row down

`src/top-row.ts`'s `isInTopRow` decides, for a given drop target, whether it
belongs to the dock's topmost row - and `left`/`right` are only unexcluded
when it doesn't. "Row" is resolved by live geometry, not tree position: a
dock can already have more than one top-level column (each starting its own
vertical stack at the same y position, e.g. after this feature has been used
a few times), and tree position alone can't distinguish those from a genuine
second row further down. A target counts as top-row when its enclosing tab
group's on-screen `top` matches the smallest `top` among every tab group in
that dock - so it correctly covers every existing top-level column at once,
not just whichever one happened to be created first.

Verified end-to-end (not just the `isInTopRow` unit checked in isolation) by
calling the real patched `app.workspace.getDropDirection` directly with
`excluded: ["left", "right"]` and real leaves from an actual two-row test
layout on both sidebars: a top-row target left the exclusion untouched
(resulting direction `"center"` for a near-edge drop), a second-row target
had it stripped (resulting direction `"left"`/`"right"` as expected) - and
the same held with a tab group itself as the target, and with two columns
already present within the second row (both correctly still counted as
non-top-row).

## Disabling

Settings → Community plugins → Better Sidebars → toggle off, or run:

```
obsidian plugin:disable id=better-sidebars
```

## Rebuilding after editing src/main.ts

```
npm install
npm run build
```
then `obsidian plugin:reload id=better-sidebars`.
