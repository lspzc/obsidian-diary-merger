import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	TAbstractFile,
	Modal,
} from "obsidian";

interface DiaryMergeSettings {
	diaryFolder: string;
	backupFolder: string;
	dateFormat: string;
	maxEntriesPerFile: number;
	autoMerge: boolean;
	mergeAction: "backup" | "delete";
}

const DEFAULT_SETTINGS: DiaryMergeSettings = {
	diaryFolder: "system/Diary",
	backupFolder: "system/Diary/bak",
	dateFormat: "YYYY-MM-DD",
	maxEntriesPerFile: 10,
	autoMerge: false,
	mergeAction: "backup",
};

export default class DiaryMergerPlugin extends Plugin {
	settings: DiaryMergeSettings;
	isMerging = false;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon("merge", "合并日记", () => {
			if (!this.isMerging) this.mergeDiaries();
		});

		this.addCommand({
			id: "merge-diaries",
			name: "合并日记",
			callback: () => {
				if (!this.isMerging) this.mergeDiaries();
			},
		});

		this.addSettingTab(new DiaryMergeSettingTab(this.app, this));

		if (this.settings.autoMerge) {
			this.registerEvent(
				this.app.vault.on("create", (file: TAbstractFile) => {
					if (
						file instanceof TFile &&
						file.parent?.path === this.settings.diaryFolder
					) {
						this.autoMergeIfNeeded();
					}
				})
			);
		}
	}

	// 自动合并检查
	async autoMergeIfNeeded() {
		if (this.isMerging) return;
		this.isMerging = true;

		try {
			// 获取今天之前的所有日记文件
			const files = await this.getDiaryFiles();

			// 计算需要合并的文件数量（排除今天）
			const filesToMergeCount = files.length;

			// 只有当今天之前的日记数量达到合并阈值时才触发合并
			if (filesToMergeCount >= this.settings.maxEntriesPerFile) {
				new Notice("自动合并日记中...");

				// 只合并最早的一组文件（达到合并阈值的部分）
				const batchSize = this.settings.maxEntriesPerFile;
				const batchToMerge = files.slice(0, batchSize);

				await this.processBatch(batchToMerge);
			}
		} catch (error) {
			console.error("自动合并失败:", error);
			new Notice("自动合并失败，请查看控制台");
		} finally {
			this.isMerging = false;
		}
	}

	// 主合并函数
	async mergeDiaries() {
		if (this.isMerging) return;
		this.isMerging = true;

		try {
			const files = await this.getDiaryFiles();
			if (files.length === 0) {
				new Notice("没有需要合并的日记文件");
				return;
			}

			// 合并时询问操作方式
			const action = await this.askForAction();
			if (!action) return;
			this.settings.mergeAction = action;

			// 将文件分成多个批次
			const batches = this.splitIntoBatches(
				files,
				this.settings.maxEntriesPerFile
			);

			for (const batch of batches) {
				await this.processBatch(batch);
			}

			new Notice(`共创建 ${batches.length} 个合并文件`);
		} catch (error) {
			console.error("合并失败:", error);
			new Notice("合并失败，请查看控制台");
		} finally {
			this.isMerging = false;
		}
	}

	// 获取日记文件列表（今天之前的）
	async getDiaryFiles(): Promise<TFile[]> {
		const diaryFolder = this.app.vault.getAbstractFileByPath(
			this.settings.diaryFolder
		);
		if (!(diaryFolder instanceof TFolder)) {
			new Notice(`日记文件夹不存在: ${this.settings.diaryFolder}`);
			return [];
		}

		const today = window.moment().format(this.settings.dateFormat);

		return diaryFolder.children
			.filter(
				(file): file is TFile =>
					file instanceof TFile && file.name.endsWith(".md")
			)
			.filter((file) => {
				const dateStr = file.basename;
				// 只包括今天之前的有效日期文件
				return (
					dateStr !== today &&
					window
						.moment(dateStr, this.settings.dateFormat, true)
						.isValid()
				);
			})
			.sort((a, b) => a.name.localeCompare(b.name)); // 按日期排序
	}

	// 从文件名中提取日期
	extractDateFromFilename(filename: string): string | null {
		const dateRegex = /(\d{4}-\d{2}-\d{2})/;
		const match = filename.match(dateRegex);
		return match ? match[1] : null;
	}

	// 询问用户如何处理重复日记文件
	async askForAction(): Promise<"backup" | "delete" | null> {
		return new Promise((resolve) => {
			class ActionModal extends Modal {
				private resolve: (value: "backup" | "delete" | null) => void;

				constructor(
					app: any,
					resolve: (value: "backup" | "delete" | null) => void
				) {
					super(app);
					this.resolve = resolve;
				}

				onOpen() {
					const { contentEl } = this;
					contentEl.addClass("diary-merge-modal");

					// ===== 头部区域 =====
					const header = contentEl.createDiv("modal-header");

					// 添加图标和标题
					const iconDiv = header.createDiv({ cls: "modal-icon" });
					iconDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-notebook-pen"><path d="M13.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L13.5 2z"/><polyline points="13.5 2 13.5 7.5 19 7.5"/><path d="M10 13.5H8"/><path d="M16 13.5h-2"/><path d="M12 16v1.5a1.5 1.5 0 0 1-3 0V10a1.5 1.5 0 0 1 3 0V16z"/></svg>`;

					header.createEl("h3", {
						text: "日记合并处理方式",
						cls: "modal-title",
					});

					// ===== 主要内容区域 =====
					const mainContent = contentEl.createDiv("modal-content");

					// 描述文本
					mainContent.createEl("p", {
						text: "检测到需要合并的日记文件，请选择处理方式：",
						cls: "modal-description",
					});

					// 带图标的选项说明
					const optionsList = mainContent.createDiv("modal-options");

					// 备份选项说明
					const backupOption = optionsList.createDiv({
						cls: "modal-option",
					});
					const iconSpan = backupOption.createSpan({
						cls: "option-icon",
					});
					iconSpan.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hard-drive-download"><path d="M12 2v8"/><path d="m8 10 4 4 4-4"/><path d="M6 20a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2Z"/><path d="M6 16h.01"/><path d="M10 16h.01"/><path d="M14 16h.01"/><path d="M18 16h.01"/></svg>`;
					backupOption.createSpan({
						text: "备份后删除：将文件备份到指定目录后再删除",
					});

					// 删除选项说明
					const deleteOption = optionsList.createDiv("modal-option");
					const iconSpan1 = deleteOption.createSpan({
						cls: "option-icon",
					});
					iconSpan1.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

					deleteOption.createSpan({
						text: "直接删除：永久删除文件（不可恢复）",
					});

					// ===== 按钮区域 =====
					const buttonsContainer = contentEl.createDiv(
						"modal-button-container"
					);

					// 备份按钮
					const backupBtn = buttonsContainer.createEl("button", {
						text: "备份后删除",
						cls: "mod-cta",
					});
					backupBtn.onclick = async () => {
						const startTime = Date.now();
						this.showLoading(backupBtn, "正在备份...");
						await new Promise((resolve) => {
							const elapsed = Date.now() - startTime;
							const remaining = Math.max(0, 2000 - elapsed);
							setTimeout(resolve, remaining);
						});
						this.resolve("backup");
						this.close();
					};

					// 删除按钮
					const deleteBtn = buttonsContainer.createEl("button", {
						text: "直接删除",
						cls: "mod-warning",
					});
					deleteBtn.onclick = async () => {
						const startTime = Date.now();
						this.showLoading(deleteBtn, "正在删除...");
						await new Promise((resolve) => {
							const elapsed = Date.now() - startTime;
							const remaining = Math.max(0, 2000 - elapsed);
							setTimeout(resolve, remaining);
						});
						this.resolve("delete");
						this.close();
					};

					// 取消按钮
					const cancelBtn = buttonsContainer.createEl("button", {
						text: "取消",
						cls: "mod-muted",
					});
					cancelBtn.onclick = () => {
						this.resolve(null);
						this.close();
					};
				}

				/**
				 * 显示按钮加载状态
				 * @param button 按钮元素
				 * @param loadingText 加载时显示的文本
				 */
				showLoading(button: HTMLButtonElement, loadingText: string) {
					const originalText = button.textContent;
					button.disabled = true;
					button.innerHTML = `
                    <span class="loading-spinner"></span>
                    ${loadingText}
                `;

					// 如果关闭时仍在加载，恢复按钮状态
					this.onClose = () => {
						button.disabled = false;
						button.textContent = originalText;
					};
				}

				onClose() {
					const { contentEl } = this;
					// 确保在关闭时解析Promise
					this.resolve(null);
					contentEl.empty();
				}
			}

			const modal = new ActionModal(this.app, resolve);
			modal.open();
		});
	}

	// 处理一个批次的文件
	async processBatch(batch: TFile[]) {
		if (batch.length === 0) return;

		// 计算当前批次的日期范围
		const firstFileDate = this.extractDateFromFilename(batch[0].name);
		const lastFileDate = this.extractDateFromFilename(
			batch[batch.length - 1].name
		);

		if (!firstFileDate || !lastFileDate) {
			new Notice("无法从文件名中提取日期");
			return;
		}

		// 创建合并文件
		const mergedFileName = `merged-${firstFileDate}_to_${lastFileDate}.md`;
		const mergedFilePath = `${this.settings.diaryFolder}/${mergedFileName}`;

		// 创建合并内容
		let mergedContent = "";
		for (const file of batch) {
			const content = await this.app.vault.read(file);
			mergedContent += `# ${file.basename}\n\n${content}\n\n`;
		}

		// 创建或覆盖合并文件
		await this.app.vault.create(mergedFilePath, mergedContent);

		// 备份当前批次（如果需要）
		if (this.settings.mergeAction === "backup") {
			await this.backupFiles(batch);
		}

		// 删除原始文件
		if (
			this.settings.mergeAction === "delete" ||
			this.settings.mergeAction === "backup"
		) {
			for (const file of batch) {
				await this.app.vault.delete(file);
			}
		}

		new Notice(`已创建合并文件: ${mergedFileName}`);
	}

	// 将文件分成多个批次
	splitIntoBatches(files: TFile[], batchSize: number): TFile[][] {
		const batches = [];
		for (let i = 0; i < files.length; i += batchSize) {
			batches.push(files.slice(i, i + batchSize));
		}
		return batches;
	}

	// 备份文件
	async backupFiles(files: TFile[]) {
		const backupPath = this.settings.backupFolder;
		let backupFolder = this.app.vault.getAbstractFileByPath(backupPath);

		if (!backupFolder) {
			backupFolder = await this.app.vault.createFolder(backupPath);
		}

		if (!(backupFolder instanceof TFolder)) {
			new Notice(`备份路径无效: ${backupPath}`);
			return;
		}

		for (const file of files) {
			const newPath = `${backupPath}/${file.name}`;
			await this.app.vault.copy(file, newPath);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class DiaryMergeSettingTab extends PluginSettingTab {
	plugin: DiaryMergerPlugin;

	constructor(app: App, plugin: DiaryMergerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "日记合并插件设置" });

		const tip = containerEl.createEl("div", { cls: "tip" });
		tip.createEl("div", {
			text: "注意事项",
			cls: "tip_title",
		});
		tip.createEl("small", {
			text: `
                    1. 任何一项修改，都需要重启 obsidian
                    2. 日记文件名称的日期格式，最好使用 obsidian 默认格式：YYYY-MM-DD
                    3. 使用文档地址：
                    4. 如果遇到问题，可以在 github 上 <a href="https://github.com/lspzc/obsidian-diary-merger/issues">提交issues</a>
                `,
			cls: "tip_txt",
		});

		new Setting(containerEl)
			.setName("日记文件夹路径")
			.setDesc("存储日记文件的文件夹路径")
			.addText((text) =>
				text
					.setPlaceholder("例如: system/Diary")
					.setValue(this.plugin.settings.diaryFolder)
					.onChange(async (value) => {
						this.plugin.settings.diaryFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("备份文件夹路径")
			.setDesc("备份日记的文件夹路径")
			.addText((text) =>
				text
					.setPlaceholder("例如: system/Diary/backups")
					.setValue(this.plugin.settings.backupFolder)
					.onChange(async (value) => {
						this.plugin.settings.backupFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("日记文件名称格式")
			.setDesc("日记文件名称的日期格式 (使用moment.js格式)")
			.addText((text) =>
				text
					.setPlaceholder("例如: YYYY-MM-DD")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("合并文件最大条目数")
			.setDesc("每个合并文件最大可以合并多少篇日记，默认为10")
			.addSlider((slider) =>
				slider
					.setLimits(5, 100, 5)
					.setValue(this.plugin.settings.maxEntriesPerFile)
					.onChange(async (value) => {
						this.plugin.settings.maxEntriesPerFile = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
			);

		new Setting(containerEl)
			.setName("启用自动合并")
			.setDesc("当日记数量达到阈值时自动合并旧日记")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoMerge)
					.onChange(async (value) => {
						this.plugin.settings.autoMerge = value;
						await this.plugin.saveSettings();

						if (value) {
							this.plugin.registerEvent(
								this.plugin.app.vault.on(
									"create",
									(file: TAbstractFile) => {
										if (
											file instanceof TFile &&
											file.parent?.path ===
												this.plugin.settings.diaryFolder
										) {
											this.plugin.autoMergeIfNeeded();
										}
									}
								)
							);
						}
					})
			);

		new Setting(containerEl)
			.setName("默认处理方式")
			.setDesc("合并后对原日记的处理方式")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("backup", "备份后删除")
					.addOption("delete", "直接删除")
					.setValue(this.plugin.settings.mergeAction)
					.onChange(async (value: "backup" | "delete") => {
						this.plugin.settings.mergeAction = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
