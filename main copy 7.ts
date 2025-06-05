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
	EventRef,
} from "obsidian";

interface DiaryMergeSettings {
	diaryFolder: string;
	backupFolder: string;
	mergedOutputFolder: string;
	dateFormat: string;
	maxEntriesPerFile: number;
	autoMerge: boolean;
	autoMergeNum: number;
	mergeAction: "backup" | "delete";
	showNotifications: boolean;
}

const DEFAULT_SETTINGS: DiaryMergeSettings = {
	diaryFolder: "system/Diary",
	backupFolder: "system/Diary/backups",
	mergedOutputFolder: "system/Diary/mergeds",
	dateFormat: "YYYY-MM-DD",
	maxEntriesPerFile: 10,
	autoMerge: false,
	autoMergeNum: 1,
	mergeAction: "backup",
	showNotifications: true,
};

export default class DiaryMergerPlugin extends Plugin {
	settings: DiaryMergeSettings;
	isMerging = false;
	private createEventRef: EventRef | null = null; // 新增事件引用

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

		// 注册主事件监听器
		this.createEventRef = this.app.vault.on(
			"create",
			(file: TAbstractFile) => {
				if (
					file instanceof TFile &&
					file.parent?.path === this.settings.diaryFolder
				) {
					// 检查是否创建了未来的日记
					if (this.isFutureDiary(file)) {
						this.showNotice(
							"警告：请不要创建未来的日记文件！",
							true
						);
						return;
					}

					// 如果自动合并开启且是今日日记，触发自动合并
					if (this.settings.autoMerge && this.isTodayDiary(file)) {
						this.autoMergeIfNeeded();
					}
				}
			}
		);
		this.registerEvent(this.createEventRef);
	}

	async onunload() {
		// 注销事件监听器
		if (this.createEventRef) {
			this.app.vault.offref(this.createEventRef);
		}
	}

	// 创建辅助函数显示通知
	private showNotice(message: string, important = false) {
		if (important || this.settings.showNotifications) {
			new Notice(message);
		} else {
			console.log(`[DiaryMerger] ${message}`);
		}
	}

	// 检查是否为今日日记
	isTodayDiary(file: TFile): boolean {
		const today = window.moment().format(this.settings.dateFormat);
		return file.basename === today;
	}

	// 检查是否为未来的日记
	isFutureDiary(file: TFile): boolean {
		const today = window.moment().format(this.settings.dateFormat);
		const fileDate = window.moment(
			file.basename,
			this.settings.dateFormat,
			true
		);

		return fileDate.isValid() && fileDate.isAfter(today);
	}

	// 自动合并检查
	async autoMergeIfNeeded() {
		if (this.isMerging) return;
		this.isMerging = true;

		try {
			// 获取今天之前的所有日记文件
			const files = await this.getDiaryFiles();

			// 只有当今天之前的日记数量达到自动合并阈值时才触发合并
			if (files.length >= this.settings.autoMergeNum) {
				this.showNotice("自动合并日记中...");
				await this.mergeDiariesWithAppending(files);
			}
		} catch (error) {
			console.error("自动合并失败:", error);
			this.showNotice("自动合并失败，请查看控制台", true);
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
				this.showNotice("没有需要合并的日记文件", true);
				return;
			}

			// 合并时询问操作方式
			const action = await this.askForAction();
			if (!action) return;
			this.settings.mergeAction = action;

			await this.mergeDiariesWithAppending(files);
		} catch (error) {
			console.error("合并失败:", error);
			this.showNotice("合并失败，请查看控制台", true);
		} finally {
			this.isMerging = false;
		}
	}

	// 新的合并逻辑：支持追加到现有合并文件
	async mergeDiariesWithAppending(files: TFile[]) {
		// 1. 尝试查找最新的合并文件
		const latestMergedFile = await this.findLatestMergedFile();
		let batches: TFile[][] = [];

		// 2. 如果有现有的合并文件且未满，先尝试追加
		if (latestMergedFile) {
			// 获取合并文件中的条目数
			const currentCount = await this.getEntryCountInMergedFile(
				latestMergedFile
			);
			const remainingSlots =
				this.settings.maxEntriesPerFile - currentCount;

			// 如果有剩余空间，从文件列表中取出一部分追加
			if (remainingSlots > 0) {
				const filesToAppend = files.slice(
					0,
					Math.min(remainingSlots, files.length)
				);
				await this.appendToMergedFile(latestMergedFile, filesToAppend);

				// 从待处理列表中移除已追加的文件
				files = files.slice(filesToAppend.length);
			}
		}

		// 3. 将剩余文件分成多个批次
		if (files.length > 0) {
			batches = this.splitIntoBatches(
				files,
				this.settings.maxEntriesPerFile
			);

			for (const batch of batches) {
				await this.processBatch(batch);
			}
		}

		this.showNotice(
			`共处理 ${files.length} 篇日记，创建 ${batches.length} 个新合并文件`
		);
	}

	// 获取日记文件列表（今天之前的）
	async getDiaryFiles(): Promise<TFile[]> {
		const diaryFolder = this.app.vault.getAbstractFileByPath(
			this.settings.diaryFolder
		);
		if (!(diaryFolder instanceof TFolder)) {
			this.showNotice(
				`日记文件夹不存在: ${this.settings.diaryFolder}`,
				true
			);
			return [];
		}

		// 使用 moment 对象进行比较更准确
		const today = window.moment().startOf("day");

		return diaryFolder.children
			.filter(
				(file): file is TFile =>
					file instanceof TFile &&
					file.name.endsWith(".md") &&
					!file.name.startsWith("merged-")
			)
			.filter((file) => {
				const dateStr = file.basename;
				const fileDate = window.moment(
					dateStr,
					this.settings.dateFormat,
					true
				);

				if (!fileDate.isValid()) {
					console.warn(`无效日期格式的文件: ${file.name}`);
					return false;
				}

				// 只保留今天之前的有效日期文件
				return fileDate.isBefore(today);
			})
			.sort((a, b) => a.name.localeCompare(b.name)); // 按日期排序
	}

	// 查找最新的合并文件
	async findLatestMergedFile(): Promise<TFile | null> {
		// 使用合并文件输出路径
		const outputFolder = this.app.vault.getAbstractFileByPath(
			this.settings.mergedOutputFolder
		);

		if (!(outputFolder instanceof TFolder)) return null;

		// 获取所有合并文件（以"merged-"开头）
		const mergedFiles = outputFolder.children
			.filter(
				(file): file is TFile =>
					file instanceof TFile &&
					file.name.startsWith("merged-") &&
					file.name.endsWith(".md")
			)
			.sort((a, b) => b.name.localeCompare(a.name)); // 降序排序，最新文件在前

		return mergedFiles.length > 0 ? mergedFiles[0] : null;
	}

	// 获取合并文件中的条目数
	async getEntryCountInMergedFile(file: TFile): Promise<number> {
		try {
			const content = await this.app.vault.read(file);
			// 计算一级标题的数量（每个日记条目以一个一级标题开始）
			return (content.match(/^#\s[^\n]+/gm) || []).length;
		} catch (error) {
			console.error("读取合并文件失败:", error);
			return 0;
		}
	}

	// 追加内容到现有的合并文件
	async appendToMergedFile(mergedFile: TFile, files: TFile[]) {
		if (files.length === 0) return;

		try {
			// 读取现有合并文件内容
			let mergedContent = await this.app.vault.read(mergedFile);

			// 追加新内容
			for (const file of files) {
				const content = await this.app.vault.read(file);
				mergedContent += `\n\n# ${file.basename}\n\n${content}`;
			}

			// 更新合并文件
			await this.app.vault.modify(mergedFile, mergedContent);

			// 更新合并文件名称
			try {
				// 1. 从原文件名中提取起始日期
				const oldName = mergedFile.name;
				const dateRangeMatch = oldName.match(
					/^merged-(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.md$/
				);

				if (dateRangeMatch) {
					// 2. 获取新的结束日期（最后追加的文件日期）
					const newEndDate = files[files.length - 1].basename;
					// 3. 保持原始起始日期不变
					const originalStartDate = dateRangeMatch[1];
					// 4. 生成新文件名
					const newName = `merged-${originalStartDate}_to_${newEndDate}.md`;

					// 5. 仅当日期变化时才重命名
					if (newName !== oldName) {
						const newPath = `${mergedFile.parent?.path}/${newName}`;
						await this.app.vault.rename(mergedFile, newPath);
						this.showNotice(
							`已更新合并文件名: ${oldName} → ${newName}`
						);
					}
				} else {
					console.warn("无法解析合并文件名格式，跳过重命名");
				}
			} catch (renameError) {
				console.error("重命名合并文件失败:", renameError);
				this.showNotice("合并文件重命名失败，但内容已更新", true);
			}

			// 备份或删除原始文件
			if (this.settings.mergeAction === "backup") {
				await this.backupFiles(files);
			}

			if (
				this.settings.mergeAction === "delete" ||
				this.settings.mergeAction === "backup"
			) {
				for (const file of files) {
					await this.app.vault.delete(file);
				}
			}

			this.showNotice(
				`已将 ${files.length} 篇日记追加到 ${mergedFile.name}`
			);
		} catch (error) {
			console.error("追加到合并文件失败:", error);
			this.showNotice("追加到合并文件失败，请查看控制台", true);
		}
	}

	// 处理一个批次的文件（创建新合并文件）
	async processBatch(batch: TFile[]) {
		if (batch.length === 0) return;

		// 计算当前批次的日期范围
		const firstFileDate = this.extractDateFromFilename(batch[0].name);
		const lastFileDate = this.extractDateFromFilename(
			batch[batch.length - 1].name
		);

		if (!firstFileDate || !lastFileDate) {
			this.showNotice("无法从文件名中提取日期", true);
			return;
		}

		// 创建合并文件
		const mergedFileName = `merged-${firstFileDate}_to_${lastFileDate}.md`;

		// 使用用户自定义的输出路径
		const mergedFilePath = `${this.settings.mergedOutputFolder}/${mergedFileName}`;

		// 确保输出文件夹存在
		const outputFolder = this.app.vault.getAbstractFileByPath(
			this.settings.mergedOutputFolder
		);
		if (!outputFolder) {
			await this.app.vault.createFolder(this.settings.mergedOutputFolder);
		}

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

		this.showNotice(`已创建合并文件: ${mergedFileName}`);
	}

	// 从文件名中提取日期
	extractDateFromFilename(filename: string): string | null {
		const dateRegex = /(\d{4}-\d{2}-\d{2})/;
		const match = filename.match(dateRegex);
		return match ? match[1] : null;
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
			this.showNotice(`备份路径无效: ${backupPath}`, true);
			return;
		}

		for (const file of files) {
			const newPath = `${backupPath}/${file.name}`;
			await this.app.vault.copy(file, newPath);
		}
	}

	// 询问用户如何处理重复日记文件
	async askForAction(): Promise<"backup" | "delete" | null> {
		return new Promise((resolve) => {
			class ActionModal extends Modal {
				private resolve: (value: "backup" | "delete" | null) => void;

				constructor(
					app: App,
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

		containerEl.createEl("h3", { text: "日记合并插件设置" });

		// === 顶部提示 ===
		const tip = containerEl.createEl("div", { cls: "tip" });
		tip.createEl("div", {
			text: "注意事项",
			cls: "tip_title",
		});

		// 创建提示容器
		const smallTip = tip.createEl("small", { cls: "tip_txt" });

		smallTip.append("1. 如果发现修改没有起作用，请重启 Obsidian\n");
		smallTip.append(
			"2. 日记文件名称的日期格式，最好使用 Obsidian 默认格式：YYYY-MM-DD\n"
		);
		// 点击查看文档
		smallTip.append("3. 插件文档地址：");
		smallTip.createEl("a", {
			text: "查看 github 文档",
			href: "https://community.yonyou.com/datadict/bipbook/chapter1002/chapter1002.html",
			cls: "diary-merger-smallTip-link",
		});
		smallTip.append(" 或者 ");
		smallTip.createEl("a", {
			text: "	查看 gitee 文档",
			href: "https://community.yonyou.com/datadict/bipbook/chapter1002/chapter1002.html",
			cls: "diary-merger-smallTip-link",
		});
		// 提交 Issues
		smallTip.append("\n4. 如果遇到问题，可以在 GitHub上 ");
		smallTip.createEl("a", {
			text: "提交 Issues",
			href: "https://github.com/lspzc/obsidian-diary-merger/issues",
			cls: "diary-merger-smallTip-link",
		});

		// === 中间设置项 ===
		new Setting(containerEl)
			.setName("日记文件夹路径")
			.setDesc("存储日记文件的文件夹路径 >>> 默认路径：system/Diary")
			.addText((text) =>
				text
					.setPlaceholder("例如: system/Diary")
					.setValue(this.plugin.settings.diaryFolder)
					.onChange(async (value) => {
						// 移除路径开头的斜杠避免错误
						const cleanPath = value.replace(/^\//, "");
						this.plugin.settings.diaryFolder = cleanPath;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("合并文件输出路径")
			.setDesc(
				"合并后生成文件的存储位置 >>> 默认路径：system/Diary/mergeds"
			)
			.addText((text) =>
				text
					.setPlaceholder("例如: system/Diary/mergeds")
					.setValue(this.plugin.settings.mergedOutputFolder)
					.onChange(async (value) => {
						// 移除路径开头的斜杠避免错误
						const cleanPath = value.replace(/^\//, "");
						this.plugin.settings.mergedOutputFolder = cleanPath;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("备份文件夹路径")
			.setDesc("备份日记的文件夹路径 >>> 默认路径：system/Diary/backups")
			.addText((text) =>
				text
					.setPlaceholder("例如: system/Diary/backups")
					.setValue(this.plugin.settings.backupFolder)
					.onChange(async (value) => {
						// 移除路径开头的斜杠避免错误
						const cleanPath = value.replace(/^\//, "");
						this.plugin.settings.backupFolder = cleanPath;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("日记文件名称格式")
			.setDesc(
				"日记文件名称的日期格式 >>> 建议使用 obsidian 默认格式：YYYY-MM-DD"
			)
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
			.setDesc(
				"每个合并文件最大可以合并多少篇日记 >>> 默认最大条目数：10"
			)
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
			.setName("自动合并阈值")
			.setDesc(
				"当今天以前的日记数量达到此阈值时成为触发自动合并的一个必要条件 >>> 默认合并阈值：1"
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(this.plugin.settings.autoMergeNum)
					.onChange(async (value) => {
						this.plugin.settings.autoMergeNum = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
			);

		new Setting(containerEl)
			.setName("启用自动合并")
			.setDesc(
				"自动合并触发条件：开启自动合并 && 达到自动合并阈值 && 在日记文件路径创建今天的日记 >>> 默认不启用"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoMerge)
					.onChange(async (value) => {
						this.plugin.settings.autoMerge = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("默认处理方式")
			.setDesc("合并后对原日记的处理方式 >>> 默认备份后删除")
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

		new Setting(containerEl)
			.setName("关闭操作提示")
			.setDesc(
				"启用后将关闭右上角显示操作进度和结果提示 >>> 默认显示操作提示"
			)
			.addToggle((toggle) =>
				toggle
					// 默认值取反
					.setValue(!this.plugin.settings.showNotifications)
					.onChange(async (value) => {
						// 用户开启开关时，实际关闭提示（值取反）
						this.plugin.settings.showNotifications = !value;
						await this.plugin.saveSettings();
					})
			);
	}
}
