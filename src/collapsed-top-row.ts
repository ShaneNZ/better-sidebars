import type { App, WorkspaceItem } from "obsidian";

/**
 * When a dock's top row holds only a single item and that item is removed
 * (the tab is closed), core auto-collapses the now-empty row out of the
 * tree - but it only removes that one redundant node, it doesn't recurse
 * further. If the second row held more than one column, what's left behind
 * is a single wrapper split whose own children (the former second-row
 * columns) now start at the very top of the dock - i.e. the dock's top row
 * is now made of multiple columns, reintroducing the collapse/expand chrome
 * bug this plugin exists to avoid (see top-row.ts).
 *
 * `fixEmptiedTopRow` detects that shape and repairs it: the leftmost of
 * those columns is promoted back out to be its own full-width top row, and
 * whatever other columns were there stay together, still side by side, now
 * forming the new second row. It operates on the live workspace objects
 * directly (`WorkspaceSplit.prototype.insertChild`/`removeChild`, both
 * undocumented) rather than `Workspace.changeLayout()` - reconstructing a
 * dock via `changeLayout()` with a hand-written layout object was tried
 * first and repeatedly produced the wrong visual arrangement regardless of
 * which `direction` value was used, for reasons that weren't fully pinned
 * down; live insertChild/removeChild calls on the already-correctly-
 * rendered objects behaved correctly and consistently in testing.
 */

interface InternalItem extends WorkspaceItem {
	type: string;
	containerEl: HTMLElement;
}

interface InternalParent extends InternalItem {
	children: InternalItem[];
	insertChild(index: number, item: InternalItem): void;
	removeChild(item: InternalItem): void;
}

function hasChildren(item: InternalItem): item is InternalParent {
	return Array.isArray((item as InternalParent).children);
}

/**
 * Descends through any chain of single-child splits starting at `dock`, to
 * find the point where the tree actually branches. Stops at a `tabs` node
 * (its `children` are leaves, not further structure - nothing to descend
 * into) as well as at any split with zero or 2+ children.
 */
function findBranchPoint(dock: InternalItem): InternalItem {
	let node = dock;
	while (node.type === "split" && hasChildren(node) && node.children.length === 1) {
		const onlyChild = node.children[0];
		if (!onlyChild) break;
		node = onlyChild;
	}
	return node;
}

function fixDock(dock: InternalItem): void {
	const node = findBranchPoint(dock);
	// No safe parent to promote a column out to - dock itself branching
	// directly like this isn't the shape this specific bug produces, and
	// isn't handled here.
	if (node === dock) return;
	if (node.type !== "split" || !hasChildren(node) || node.children.length < 2) return;

	const firstTop = node.children[0]?.containerEl.getBoundingClientRect().top;
	if (firstTop === undefined) return;
	const allSameTop = node.children.every(
		(c) => Math.abs(c.containerEl.getBoundingClientRect().top - firstTop) < 1
	);
	if (!allSameTop) return; // a genuine top row + second row split - leave it alone

	const sorted = [...node.children].sort(
		(a, b) => a.containerEl.getBoundingClientRect().left - b.containerEl.getBoundingClientRect().left
	);
	const leftmost = sorted[0];
	if (!leftmost) return;

	const parent = node.parent as unknown as InternalParent | null;
	if (!parent || !hasChildren(parent)) return;
	const indexInParent = parent.children.indexOf(node);
	if (indexInParent === -1) return;

	node.removeChild(leftmost);
	parent.insertChild(indexInParent, leftmost);
}

function fixEmptiedTopRow(app: App): void {
	fixDock(app.workspace.leftSplit as unknown as InternalItem);
	fixDock(app.workspace.rightSplit as unknown as InternalItem);
}

/**
 * Coalesces bursts of workspace events (closing a tab can fire several in a
 * row) into a single correction pass per animation frame. Idempotent and
 * cheap - a no-op once neither dock has this shape, including immediately
 * after it just fixed one, so it's safe to re-run on every layout change.
 */
export class TopRowCollapseCorrector {
	private readonly app: App;
	private frameId: number | null = null;

	constructor(app: App) {
		this.app = app;
	}

	schedule = (): void => {
		if (this.frameId !== null) return;
		this.frameId = window.requestAnimationFrame(() => {
			this.frameId = null;
			fixEmptiedTopRow(this.app);
		});
	};

	cancel(): void {
		if (this.frameId !== null) {
			window.cancelAnimationFrame(this.frameId);
			this.frameId = null;
		}
	}
}
