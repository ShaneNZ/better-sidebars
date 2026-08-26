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
four directions become selectable there, exactly as in the main area. No
other method is patched and no custom drag/drop handling is added for this
part - the sidebar-chrome fixes below are a separate concern, covered
separately, and do ship a small CSS override.

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
getting it wrong is easy to miss under casual testing. Obsidian's own
stylesheet has an unconditional `.workspace-ribbon.mod-right { display: none
}` rule with no equivalent for `.mod-left` (confirmed live via computed
styles on 1.12.7/1.13.7, at every dock state including collapsed) - the right
dock's ribbon container (`app.workspace.rightRibbon`) exists in the DOM but
is never rendered, expanded or collapsed. That matters beyond just where the
button sits while the dock is expanded: the left ribbon is a *persistent*
rail that stays visible even while its dock is collapsed - that's the only
reason the left toggle button survives collapse at all - and with no visible
right-side equivalent, a collapsed right dock had no on-screen way to reopen
it by mouse, only by command/shortcut, regardless of column count.

`styles.css` re-enables `.workspace-ribbon.mod-right` (`display: flex`) so it
behaves like the left one. That alone isn't sufficient, though: core's
`.workspace-ribbon .sidebar-toggle-button` rule is `position: absolute; left:
0` with no side-aware counterpart anywhere - since the ribbon container
itself is `position: static`, the button anchors to the nearest positioned
ancestor (`.app-container`, spanning the full window), so `left: 0` always
means the *window's* left edge, not the ribbon's. Harmless for the left side
(they coincide); on the right it pinned the button to the wrong side of the
screen entirely, overlapping the real left button, while still being fully
DOM-present, correctly parented, and responsive to a programmatic `.click()`.
`styles.css` adds the missing mirror (`left: auto; right: 0`) for
`.workspace-ribbon.mod-right .sidebar-toggle-button`.

This is the second time this button's placement turned out to be wrong in a
way that passed an earlier, less rigorous check: a check that only looks at
DOM ancestry or calls `.click()` directly (which bypasses rendering and
hit-testing entirely - `element.click()` fires a handler on a fully invisible
or mispositioned element exactly as readily as a correctly-placed one) proves
nothing about whether a real person can actually see or click the thing.
Treat any future change here with real skepticism until it's verified via
actual on-screen geometry (`offsetParent !== null`, a non-zero
`getBoundingClientRect()` at the expected screen position) and, ideally, an
actual screenshot - across all of: expanded with one column, expanded with
several, and collapsed.

`src/dock-chrome.ts`'s `findButtonDestination` checks the ribbon's own live
computed `display` rather than hardcoding "left ribbon good, right ribbon
bad" - so with the CSS override in place, both sides now take the same
ribbon-based path. It still falls back to the outer column's own topmost tab
group's `.workspace-tab-header-container`, in-flow, if a ribbon is ever
genuinely unavailable on either side - the same place an unpatched core
naturally (and visibly, just in the wrong column) puts a misplaced button -
though that fallback can't survive a dock collapse the way the ribbon does,
since the whole column (header included) hides along with it. Same
fragility caveat as above: this leans on undocumented internals
(`leftSplit`/`rightSplit`/`leftRibbon`/`rightRibbon` internal shape, and the
ribbon's CSS), confirmed against Obsidian 1.12.7/1.13.7.

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

### A startup race worth knowing about

The first correction pass runs one animation frame after `onload()` - fine
for reacting to `layout-change`/`resize` during normal use, but on a plugin
reload (and, per the timing involved, plausibly some app startups) that one
frame can land *before* `styles.css`'s `.workspace-ribbon.mod-right { display:
flex }` override has actually taken effect in computed style. When that
happens, that first pass correctly falls back to the tab-header placement
given what it could see at that instant - and nothing naturally triggers a
second pass afterward, since styles settling doesn't itself fire a
layout-change/resize event. Reproduced reliably: a bare `plugin:reload`
followed immediately by checking the button's parent, with no manual
`layout-change` trigger in between, landed on the fallback instead of the
ribbon every time before this was addressed.

`startDockChromeCorrection()` in `src/main.ts` now schedules a short burst of
follow-up corrections (50ms / 300ms / 1s) after the initial one, in addition
to the normal event-driven ones. Each pass is cheap and idempotent - a no-op
once placement is already correct - so this costs nothing beyond the first
second after enabling. Verified by reloading the plugin repeatedly with no
manual trigger and checking the button's actual parent and on-screen rect
each time (not just once - the race is intermittent by nature).

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
