import { EventRef, Plugin, WorkspaceItem } from "obsidian";
import {
	BetterSidebarsSettingTab,
	BetterSidebarsSettings,
	DEFAULT_SETTINGS,
} from "./settings";
import { DockChromeCorrector } from "./dock-chrome";

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
 * main area, so this plugin patches just that one method to stop excluding them.
 */
export default class BetterSidebarsPlugin extends Plugin {
	settings: BetterSidebarsSettings = { ...DEFAULT_SETTINGS };

	private originalGetDropDirection: GetDropDirectionFn | null = null;
	private dockChromeCorrector: DockChromeCorrector | null = null;
	private dockChromeEventRefs: EventRef[] = [];
	private dockChromeStartupTimeoutIds: number[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new BetterSidebarsSettingTab(this.app, this));

		if (this.settings.enabled) {
			this.patchWorkspace();
			this.startDockChromeCorrection();
		}
	}

	onunload(): void {
		this.unpatchWorkspace();
		this.stopDockChromeCorrection();
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
			this.startDockChromeCorrection();
		} else {
			this.unpatchWorkspace();
			this.stopDockChromeCorrection();
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

			if (isSidebar && Array.isArray(excluded)) {
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

	private startDockChromeCorrection(): void {
		if (this.dockChromeCorrector) return; // already running

		const corrector = new DockChromeCorrector(this.app);
		this.dockChromeCorrector = corrector;
		this.dockChromeEventRefs = [
			this.app.workspace.on("layout-change", corrector.schedule),
			this.app.workspace.on("resize", corrector.schedule),
		];
		// registerEvent() ties these to the plugin's own unload as a backstop;
		// stopDockChromeCorrection() below additionally offrefs them itself so
		// toggling the setting off/on repeatedly can't accumulate listeners.
		this.dockChromeEventRefs.forEach((ref) => this.registerEvent(ref));

		// The very first correction, run synchronously here, lands one frame
		// after onload() - which, on a plugin reload (and, going by testing,
		// possibly on some app startups too) can be earlier than styles.css's
		// `.workspace-ribbon.mod-right { display: flex }` override has actually
		// taken effect in computed style. When that happens, this first pass
		// correctly (given what it can see at that instant) falls back to the
		// in-flow tab-header placement instead of the ribbon - and nothing
		// naturally re-triggers a second pass afterward, since no further
		// layout-change/resize event fires just from styles settling. A short
		// burst of follow-up corrections catches that: each is idempotent and
		// cheap, so retrying a few times over the first second after enabling
		// costs nothing once the first one already got it right.
		corrector.schedule();
		for (const delay of [50, 300, 1000]) {
			this.dockChromeStartupTimeoutIds.push(window.setTimeout(() => corrector.schedule(), delay));
		}
	}

	private stopDockChromeCorrection(): void {
		this.dockChromeEventRefs.forEach((ref) => this.app.workspace.offref(ref));
		this.dockChromeEventRefs = [];
		this.dockChromeStartupTimeoutIds.forEach((id) => window.clearTimeout(id));
		this.dockChromeStartupTimeoutIds = [];
		this.dockChromeCorrector?.cancel();
		this.dockChromeCorrector = null;
	}
}
