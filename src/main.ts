import { EventRef, Plugin, WorkspaceItem } from "obsidian";
import {
	BetterSidebarsSettingTab,
	BetterSidebarsSettings,
	DEFAULT_SETTINGS,
} from "./settings";
import { isInTopRow } from "./top-row";
import { TopRowCollapseCorrector } from "./collapsed-top-row";

type DropDirection = "left" | "right" | "top" | "bottom" | "center";

type GetDropDirectionFn = (
	event: MouseEvent,
	rect: DOMRect,
	excluded: DropDirection[] | null | undefined,
	target: WorkspaceItem
) => DropDirection;

interface WorkspaceWithDropDirection {
	getDropDirection: GetDropDirectionFn;
}

/**
 * Obsidian's own tab-drag handler (Workspace.prototype.onDragLeaf, private/undocumented)
 * already builds and executes real left/right splits in the sidebar via the same
 * Workspace.splitLeaf() path the main editor area uses. It only *offers* top/bottom
 * as candidate directions there, though - left/right are pre-excluded before the
 * candidate list ever reaches Workspace.getDropDirection(). That exclusion is the
 * only thing standing between core sidebar drag behavior and full parity with the
 * main area, so this plugin patches just that one method to stop excluding them -
 * except in the dock's own top row (see ./top-row.ts), which always stays a
 * single, full-width tab group; columns can only be created from the second
 * row down.
 *
 * That invariant needs active upkeep, not just gatekeeping at creation time:
 * if the top row ever holds only a single item and that item is closed, core
 * auto-collapses it out of the tree, and if the second row had more than one
 * column, what's left behind is exactly the shape this plugin exists to
 * avoid - see ./collapsed-top-row.ts.
 */
export default class BetterSidebarsPlugin extends Plugin {
	settings: BetterSidebarsSettings = { ...DEFAULT_SETTINGS };

	private originalGetDropDirection: GetDropDirectionFn | null = null;
	private topRowCollapseCorrector: TopRowCollapseCorrector | null = null;
	private topRowCollapseEventRefs: EventRef[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new BetterSidebarsSettingTab(this.app, this));

		if (this.settings.enabled) {
			this.patchWorkspace();
			this.startTopRowCollapseCorrection();
		}
	}

	onunload(): void {
		this.unpatchWorkspace();
		this.stopTopRowCollapseCorrection();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<BetterSidebarsSettings>
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async setEnabled(enabled: boolean): Promise<void> {
		this.settings.enabled = enabled;
		await this.saveSettings();

		if (enabled) {
			this.patchWorkspace();
			this.startTopRowCollapseCorrection();
		} else {
			this.unpatchWorkspace();
			this.stopTopRowCollapseCorrection();
		}
	}

	private patchWorkspace(): void {
		if (this.originalGetDropDirection) return; // already patched

		const workspace = this.app.workspace;
		const patchable = workspace as unknown as WorkspaceWithDropDirection;
		const original = patchable.getDropDirection.bind(workspace);
		this.originalGetDropDirection = original;

		const leftSplit = workspace.leftSplit;
		const rightSplit = workspace.rightSplit;

		const patched: GetDropDirectionFn = (event, rect, excluded, target) => {
			const root = target?.getRoot ? target.getRoot() : null;
			const isSidebar = root === leftSplit || root === rightSplit;

			// The dock's own top row stays a single, full-width tab group -
			// columns can only be created from the second row down.
			if (isSidebar && root && Array.isArray(excluded) && !isInTopRow(target, root)) {
				excluded = excluded.filter(
					(direction) => direction !== "left" && direction !== "right"
				);
			}

			return original(event, rect, excluded, target);
		};

		patchable.getDropDirection = patched;
	}

	private unpatchWorkspace(): void {
		if (!this.originalGetDropDirection) return; // not currently patched

		const patchable = this.app.workspace as unknown as WorkspaceWithDropDirection;
		patchable.getDropDirection = this.originalGetDropDirection;
		this.originalGetDropDirection = null;
	}

	private startTopRowCollapseCorrection(): void {
		if (this.topRowCollapseCorrector) return; // already running

		const corrector = new TopRowCollapseCorrector(this.app);
		this.topRowCollapseCorrector = corrector;
		this.topRowCollapseEventRefs = [this.app.workspace.on("layout-change", corrector.schedule)];
		this.topRowCollapseEventRefs.forEach((ref) => this.registerEvent(ref));
		corrector.schedule(); // covers this shape already existing on disk at startup
	}

	private stopTopRowCollapseCorrection(): void {
		this.topRowCollapseEventRefs.forEach((ref) => this.app.workspace.offref(ref));
		this.topRowCollapseEventRefs = [];
		this.topRowCollapseCorrector?.cancel();
		this.topRowCollapseCorrector = null;
	}
}
