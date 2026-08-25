import { App, PluginSettingTab, Setting } from "obsidian";
import type BetterSidebarsPlugin from "./main";

export interface BetterSidebarsSettings {
	enabled: boolean;
}

export const DEFAULT_SETTINGS: BetterSidebarsSettings = {
	enabled: true,
};

export class BetterSidebarsSettingTab extends PluginSettingTab {
	plugin: BetterSidebarsPlugin;

	constructor(app: App, plugin: BetterSidebarsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Allow multi-column sidebars")
			.setDesc(
				"When on, dragging a tab to the left/right edge of a sidebar pane creates a new side-by-side column, same as in the main editor area. When off, sidebars behave as stock Obsidian (top/bottom splits and tab-stacking only)."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
					await this.plugin.setEnabled(value);
				})
			);
	}
}
