import type { App, WorkspaceItem, WorkspaceRibbon } from "obsidian";

type Side = "left" | "right";

/**
 * Obsidian's sidebar chrome - the collapse/expand toggle button
 * (`.sidebar-toggle-button`) and the `mod-top` / `mod-top-{side}-space` classes
 * that make a dock's topmost tab strip blend into the (hidden, frameless)
 * titlebar and double as a window-drag region - was built assuming a sidedock
 * only ever holds one tab group. Once BetterSidebars lets a dock hold more than
 * one side-by-side column, core's own placement logic for that chrome breaks:
 * the toggle button gets attached inside whichever tab group happens to be
 * first in the dock's internal tree (not necessarily the one actually touching
 * the window edge), and the `mod-top*` classes stop being assigned to anything.
 * None of this is `getDropDirection`'s doing - it's unrelated core layout code
 * with a gap this plugin's own feature exposes.
 *
 * `correctDockChrome` re-derives, from live geometry rather than tree position
 * (which is what core's own logic gets wrong), which tab group in each dock
 * should hold the chrome, and repairs the DOM/classes if they've drifted. It's
 * cheap and idempotent, so it's safe to re-run on every layout change, and a
 * no-op for the stock single-column case.
 *
 * Where to put the button is genuinely asymmetric between sides, and it's not
 * optional to get right: Obsidian's own stylesheet has an unconditional
 * `.workspace-ribbon.mod-right { display: none }` rule (no matching rule for
 * `.mod-left`, confirmed live via computed styles) - the right dock's ribbon
 * container exists in the DOM but is never visible. A button moved in there
 * is fully DOM-present and still answers `.click()` (which bypasses rendering
 * entirely, which is how an earlier version of this fix looked correct under
 * test but wasn't - `offsetParent`/`getBoundingClientRect()` on that earlier
 * placement showed it was never actually on screen), but a real person can
 * never see or click it. So `findButtonDestination` checks the ribbon's own
 * computed `display` live and only uses it when it's genuinely visible;
 * otherwise it falls back to the outer column's own topmost tab group's
 * `.workspace-tab-header-container` (in-flow, ordinary flex placement,
 * confirmed via live DOM inspection to be a direct child of a `tabs` node's
 * `containerEl`) - which is also exactly where an unpatched core naturally
 * puts a misplaced-but-visible button, so this doubles as the fix for the
 * original misplacement bug on whichever side lacks a working ribbon.
 *
 * A further complication (see `ensureButton` below): enough successive column
 * splits can leave a dock in a shape where core doesn't merely misplace the
 * toggle button, it never creates one for that side at all. Live testing found
 * nothing that makes core rebuild it, so in that case this module reproduces
 * the button itself rather than just relocating one core already made.
 */

interface InternalItem extends WorkspaceItem {
	type: string;
	containerEl: HTMLElement;
}

interface InternalParent extends InternalItem {
	children: InternalItem[];
}

interface WorkspaceWithRibbons {
	leftRibbon: WorkspaceRibbon;
	rightRibbon: WorkspaceRibbon;
}

interface RibbonWithContainer {
	containerEl: HTMLElement;
}

interface AppWithCommands {
	commands: { executeCommandById(id: string): boolean };
}

const SYNTHETIC_ATTR = "data-better-sidebars-synthetic";

function findRealButton(doc: Document, side: Side): HTMLElement | null {
	return doc.querySelector<HTMLElement>(`.sidebar-toggle-button.mod-${side}:not([${SYNTHETIC_ATTR}])`);
}

function findSyntheticButton(doc: Document, side: Side): HTMLElement | null {
	return doc.querySelector<HTMLElement>(`.sidebar-toggle-button.mod-${side}[${SYNTHETIC_ATTR}]`);
}

/**
 * Core builds each side's toggle button once and, as far as live testing could
 * establish, never rebuilds it - not on layout-change, not even on a full
 * `Workspace.changeLayout()` replay of the exact same layout. Every
 * Workspace/WorkspaceRibbon method that looked like a plausible trigger
 * (`updateFrameless`, `updateLayout`, `onLayoutChange`, `onResize`,
 * `updateOptions`, `changeLayout`) was tried against several dock shapes
 * (single tabs child, a direct tabs child at index 0 vs. 1, the exact
 * two-column-each-internally-split shape that triggers this) - none of them
 * repopulate a missing button. Whatever earlier core operation destroys it
 * (observed after enough successive column splits that neither of a dock's
 * direct children is a plain `tabs` node any more) just isn't undone by
 * anything short of restarting Obsidian.
 *
 * So when a side has no real, core-built button left, this clones whichever
 * side still has one, mirrors the `mod-left`/`mod-right` class (the existing
 * stylesheet already uses that class to flip the icon, so no manual mirroring
 * needed), and wires its click to the same command core's own button runs.
 * The clone is tagged with `data-better-sidebars-synthetic` so later passes
 * can tell it apart from a real one - if core ever does end up with a genuine
 * button for that side again (e.g. the dock's shape changes back), the
 * stand-in is removed rather than left duplicated. This is a materially more
 * fragile patch than the rest of this plugin: it's not relocating something
 * core built, it's reproducing core's own chrome by hand.
 */
function ensureButton(doc: Document, app: App, side: Side): HTMLElement | null {
	const real = findRealButton(doc, side);
	const synthetic = findSyntheticButton(doc, side);

	if (real) {
		synthetic?.remove(); // core's own button exists again - drop the stand-in
		return real;
	}
	if (synthetic) return synthetic;

	const otherSide: Side = side === "left" ? "right" : "left";
	const template = findRealButton(doc, otherSide);
	if (!template) return null; // no real button anywhere to clone from

	const clone = template.cloneNode(true) as HTMLElement;
	clone.classList.remove(`mod-${otherSide}`);
	clone.classList.add(`mod-${side}`);
	clone.setAttribute(SYNTHETIC_ATTR, "true");
	clone.addEventListener("click", () => {
		(app as unknown as AppWithCommands).commands.executeCommandById(`app:toggle-${side}-sidebar`);
	});
	return clone;
}

function hasChildren(item: InternalItem): item is InternalParent {
	return Array.isArray((item as InternalParent).children);
}

/** The tab group nearest the top of the window within `item`'s subtree. */
function findTopmostTabs(item: InternalItem): InternalItem | null {
	if (item.type === "tabs") return item;
	if (!hasChildren(item) || item.children.length === 0) return null;

	let best: InternalItem | null = null;
	let bestTop = Infinity;
	for (const child of item.children) {
		const candidate = findTopmostTabs(child);
		if (!candidate) continue;
		const top = candidate.containerEl.getBoundingClientRect().top;
		if (top < bestTop) {
			bestTop = top;
			best = candidate;
		}
	}
	return best;
}

/** Every tab group in `item`'s subtree, appended into `out`. */
function collectTabGroups(item: InternalItem, out: InternalItem[]): void {
	if (item.type === "tabs") {
		out.push(item);
		return;
	}
	if (hasChildren(item)) {
		for (const child of item.children) collectTabGroups(child, out);
	}
}

/** The column (a direct child of the dock) whose edge sits closest to the window edge. */
function findOuterColumn(columns: InternalItem[], side: Side): InternalItem {
	const edgeOf = (item: InternalItem): number => {
		const rect = item.containerEl.getBoundingClientRect();
		return side === "left" ? rect.left : rect.right;
	};
	return columns.reduce((outer, column) => {
		const better = side === "left" ? edgeOf(column) < edgeOf(outer) : edgeOf(column) > edgeOf(outer);
		return better ? column : outer;
	});
}

interface ButtonDestination {
	container: HTMLElement;
	prepend: boolean;
}

/**
 * The ribbon when it's genuinely visible (checked live - see the module
 * docblock for why this can't be assumed per-side), otherwise the outer
 * column's own topmost tab group's header row, in-flow.
 */
function findButtonDestination(app: App, side: Side, outerTop: InternalItem | null): ButtonDestination | null {
	const ribbonKey = side === "left" ? "leftRibbon" : "rightRibbon";
	const ribbon = (app.workspace as unknown as WorkspaceWithRibbons)[ribbonKey];
	const ribbonEl = (ribbon as unknown as RibbonWithContainer)?.containerEl;
	if (ribbonEl && ribbonEl.ownerDocument.defaultView?.getComputedStyle(ribbonEl).display !== "none") {
		return { container: ribbonEl, prepend: true };
	}

	if (!outerTop) return null;
	const headerContainer = outerTop.containerEl.querySelector<HTMLElement>(
		":scope > .workspace-tab-header-container"
	);
	if (!headerContainer) return null;
	// Leftmost-in-flow for the left dock, rightmost for the right dock.
	return { container: headerContainer, prepend: side === "left" };
}

function correctSide(app: App, side: Side): void {
	const dock = (
		side === "left" ? app.workspace.leftSplit : app.workspace.rightSplit
	) as unknown as InternalItem;
	if (!hasChildren(dock) || dock.children.length === 0) return;

	const columns = dock.children;
	const outer = columns.length > 1 ? findOuterColumn(columns, side) : columns[0];
	if (!outer) return;
	const outerTop = findTopmostTabs(outer);

	const button = ensureButton(dock.containerEl.ownerDocument, app, side);
	const destination = findButtonDestination(app, side, outerTop);
	if (button && destination && button.parentElement !== destination.container) {
		if (destination.prepend) {
			destination.container.prepend(button);
		} else {
			destination.container.append(button);
		}
	}

	// Every column's own topmost tab group blends into the titlebar (mod-top);
	// only the column actually touching the window edge also needs the padding
	// that makes room for the toggle button there (mod-top-{side}-space).
	const desiredTop = new Set<InternalItem>();
	const desiredSpace = new Set<InternalItem>();
	for (const column of columns) {
		const top = findTopmostTabs(column);
		if (!top) continue;
		desiredTop.add(top);
		if (column === outer) desiredSpace.add(top);
	}

	const spaceClass = side === "left" ? "mod-top-left-space" : "mod-top-right-space";
	const allGroups: InternalItem[] = [];
	collectTabGroups(dock, allGroups);
	for (const group of allGroups) {
		group.containerEl.classList.toggle("mod-top", desiredTop.has(group));
		group.containerEl.classList.toggle(spaceClass, desiredSpace.has(group));
	}
}

/**
 * Coalesces bursts of workspace events (a drag can fire several in a row) into
 * a single correction pass per animation frame.
 */
export class DockChromeCorrector {
	private readonly app: App;
	private frameId: number | null = null;

	constructor(app: App) {
		this.app = app;
	}

	schedule = (): void => {
		if (this.frameId !== null) return;
		this.frameId = window.requestAnimationFrame(() => {
			this.frameId = null;
			correctSide(this.app, "left");
			correctSide(this.app, "right");
		});
	};

	cancel(): void {
		if (this.frameId !== null) {
			window.cancelAnimationFrame(this.frameId);
			this.frameId = null;
		}
	}
}
