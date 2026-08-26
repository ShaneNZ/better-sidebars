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

### Keeping that invariant when the top row empties out

Gatekeeping *creation* isn't enough on its own: if the top row holds only a
single item and that item's tab is closed, core auto-collapses the
now-redundant row out of the tree - but it only removes that one node, it
doesn't recurse any further. If the second row had more than one column,
what's left behind is a single wrapper whose own children (the former
second-row columns) now start at the very top of the dock - the top row is
now made of multiple columns, which is exactly the shape this plugin exists
to prevent (and the shape that broke the sidebar's own collapse/expand
chrome in earlier testing, before this restriction existed).

`src/collapsed-top-row.ts`'s `TopRowCollapseCorrector` watches for this on
every `layout-change` and repairs it: the leftmost of those columns is
promoted back out to be its own full-width top row, and whatever other
columns were there stay together, still side by side, now forming the new
second row.

It operates on the live workspace objects directly -
`WorkspaceSplit.prototype.insertChild`/`removeChild`, both undocumented -
rather than `Workspace.changeLayout()`. Reconstructing a dock via
`changeLayout()` with a hand-written layout object was tried first and
repeatedly produced the wrong visual arrangement (columns rendering stacked
when the layout object asked for side-by-side, or vice versa) regardless of
which `direction` value was used, for reasons that weren't fully pinned
down even after isolated calibration tests; live `insertChild`/`removeChild`
calls on the already-correctly-rendered objects behaved correctly and
consistently across every test.

Verified by reproducing the exact failure via real leaf-splitting API calls
(not hand-crafted layout JSON) on both sidebars, with both two- and
three-column second rows, closing the top row's leaf, and confirming the
plugin corrected it automatically - no manual intervention - back to a
single full-width top row with the remaining columns intact and still
side by side underneath. No console errors throughout.

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
