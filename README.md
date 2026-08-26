# Better Sidebars

Lets you drag a tab to the left/right edge of a pane in the left or right sidebar
to create a new side-by-side column there, the same way dragging to an edge in
the main editor area creates a new column. Dropping in the center of a pane (or
on its tab strip) still just stacks the dragged tab into that pane, unchanged.

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

### Sidebar chrome placement (toggle button, top-row styling)

Splitting the sidebar mechanism itself was never restricted, but Obsidian's
placement of the sidebar's own chrome was written assuming a dock only ever
holds one tab group. Once a dock holds more than one side-by-side column,
core's logic for two things breaks: the collapse/expand toggle button
(`.sidebar-toggle-button`) gets attached inside whichever tab group happens to
be first in the dock's internal tree - not necessarily the one actually
touching the window edge - and can end up detached into the main editor area
entirely after a collapse/expand cycle; and the `mod-top` /
`mod-top-{side}-space` classes that make a dock's topmost tab strip blend into
the (hidden, frameless) titlebar and act as a window-drag region stop being
assigned to anything.

`src/dock-chrome.ts` re-derives the correct placement from live geometry - not
tree position, which is what core's own logic gets wrong - on every
`layout-change`/`resize` event: each column's own topmost tab group gets
`mod-top`, and only the column whose edge is actually closest to the window
edge additionally gets the `mod-top-{side}-space` padding. It's a no-op for
the stock single-column case.

Where the toggle button itself belongs is genuinely different per side, and
getting it wrong is easy to miss under casual testing: Obsidian's own
stylesheet has an unconditional `.workspace-ribbon.mod-right { display: none
}` rule with no equivalent for `.mod-left` (confirmed live via computed
styles on 1.12.7/1.13.7) - the right dock's ribbon container
(`app.workspace.rightRibbon`) exists in the DOM but is never rendered. A
button placed there is fully DOM-present and still responds to `.click()`
(which bypasses rendering and hit-testing entirely - `element.click()` fires
the handler on an invisible element just as readily as a visible one), which
is exactly why an earlier version of this fix looked correct under a
DOM-ancestry-and-click check but wasn't: `offsetParent`/
`getBoundingClientRect()` on that placement showed it was never actually on
screen. `findButtonDestination` now checks the ribbon's own computed
`display` live and only uses it when genuinely visible (true for the left
dock so far); otherwise it falls back to the outer column's own topmost tab
group's `.workspace-tab-header-container`, in-flow, the same place an
unpatched core naturally (and visibly, just in the wrong column) puts a
misplaced button. Same fragility caveat as above: this leans on undocumented
internals (`leftSplit`/`rightSplit`/`leftRibbon`/`rightRibbon` internal
shape, and the ribbon's CSS), confirmed against Obsidian 1.12.7/1.13.7 - and
this is the second time this file's placement logic turned out to be wrong in
a way that passed an earlier, less rigorous check, so treat any future change
here with real skepticism until it's verified via actual on-screen geometry
(`offsetParent !== null`, a non-zero `getBoundingClientRect()`, ideally a
screenshot), not just DOM presence or a programmatic `.click()`.

Enough successive column splits can leave a dock in a shape where neither of
its direct children is a plain `tabs` node any more (e.g. two side-by-side
columns that are each internally split top/bottom). At that point core doesn't
just misplace the toggle button for that side - it never creates one. Testing
found nothing (`updateFrameless`, `updateLayout`, `changeLayout`, and others)
that makes core rebuild it once that's happened. When that occurs, this plugin
clones whichever side still has a real button, mirrors the `mod-left`/
`mod-right` class, and wires its click to the same command core's own button
runs - tagged so a later pass can tell it apart from a genuine core-built one
and remove the stand-in if core's own button ever comes back. This is a more
fragile patch than everything else in this plugin: it's reproducing a piece of
core's chrome by hand rather than relocating something core already built.

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
