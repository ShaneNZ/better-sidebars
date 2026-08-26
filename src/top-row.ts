import type { WorkspaceItem } from "obsidian";

/**
 * Multi-column splitting is restricted to the second row of a sidebar dock
 * and below - the dock's own topmost row stays a single, full-width tab
 * group. Left/right drop directions are only offered when the drag target
 * lives outside that top row.
 *
 * "Row" is determined by live geometry (each tab group's own on-screen
 * `top`), not tree position: a dock can already have more than one
 * top-level column (each starting its own vertical stack at the same y
 * position), and tree position alone can't tell those apart from a genuine
 * second row further down. A target belongs to the top row when its
 * enclosing tab group's `top` matches the smallest `top` among every tab
 * group in the dock.
 */

interface InternalItem extends WorkspaceItem {
	type: string;
	containerEl: HTMLElement;
}

interface InternalParent extends InternalItem {
	children: InternalItem[];
}

function hasChildren(item: InternalItem): item is InternalParent {
	return Array.isArray((item as InternalParent).children);
}

/**
 * Walks up from `target` to the tab group that owns it (or `target` itself,
 * if it already is one). `WorkspaceItem.parent` is typed as always present,
 * but that's only guaranteed down to the workspace root - capped to be safe
 * against an unexpected shape rather than looping forever.
 */
function findEnclosingTabs(target: InternalItem): InternalItem | null {
	let current: InternalItem | null = target;
	for (let i = 0; current && current.type !== "tabs" && i < 50; i++) {
		current = (current.parent as InternalItem | undefined) ?? null;
	}
	return current && current.type === "tabs" ? current : null;
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

export function isInTopRow(target: WorkspaceItem, dock: WorkspaceItem): boolean {
	const group = findEnclosingTabs(target as InternalItem);
	if (!group) return false; // can't determine - fail open, same as this plugin's behavior before this restriction existed

	const groups: InternalItem[] = [];
	collectTabGroups(dock as InternalItem, groups);
	if (groups.length === 0) return false;

	const tops = groups.map((g) => g.containerEl.getBoundingClientRect().top);
	const minTop = Math.min(...tops);
	const groupTop = group.containerEl.getBoundingClientRect().top;
	return Math.abs(groupTop - minTop) < 1;
}
