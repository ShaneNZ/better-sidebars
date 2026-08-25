import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type BetterSidebarsPlugin from "./main";

export interface BetterSidebarsSettings {
	enabled: boolean;
}

export const DEFAULT_SETTINGS: BetterSidebarsSettings = {
	enabled: true,
};

const ALLOW_MULTI_COLUMN_DESC =
	"When on, dragging a tab to the left/right edge of a sidebar pane creates a new side-by-side column, same as in the main editor area. When off, sidebars behave as stock Obsidian (top/bottom splits and tab-stacking only).";

export class BetterSidebarsSettingTab extends PluginSettingTab {
	plugin: BetterSidebarsPlugin;

	constructor(app: App, plugin: BetterSidebarsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Imperative fallback for Obsidian < 1.13.0, which doesn't know about
	// getSettingDefinitions()/update() and calls display() directly. Bypassed
	// automatically on 1.13+ once getSettingDefinitions() returns items below.
	// Remove this once minAppVersion is raised to 1.13.0 or later.
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Allow multi-column sidebars")
			.setDesc(ALLOW_MULTI_COLUMN_DESC)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
					await this.plugin.setEnabled(value);
				})
			);
	}

	// Declarative settings for Obsidian >= 1.13.0, so this setting shows up
	// in the settings search.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Allow multi-column sidebars",
				desc: ALLOW_MULTI_COLUMN_DESC,
				control: {
					type: "toggle",
					key: "enabled",
					defaultValue: DEFAULT_SETTINGS.enabled,
				},
			},
		];
	}

	// setEnabled() applies/reverts the workspace patch immediately, in
	// addition to persisting the value - the default setControlValue() would
	// only persist it.
	setControlValue(key: string, value: unknown): void | Promise<void> {
		if (key === "enabled") {
			return this.plugin.setEnabled(value as boolean);
		}
	}
}
