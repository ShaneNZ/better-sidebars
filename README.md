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
`layout-change`/`resize` event: the toggle button always belongs in the dock's
own ribbon container (`app.workspace.leftRibbon`/`rightRibbon`, a fixed
element outside the split/tabs tree, unaffected by column count), each
column's own topmost tab group gets `mod-top`, and only the column whose edge
is actually closest to the window edge additionally gets the
`mod-top-{side}-space` padding. It's a no-op for the stock single-column case.
Same fragility caveat as above: this leans on the same handful of undocumented
internals (`leftSplit`/`rightSplit`/`leftRibbon`/`rightRibbon` internal shape),
confirmed against Obsidian 1.12.7/1.13.7.

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
