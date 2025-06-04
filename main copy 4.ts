import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder,TAbstractFile } from 'obsidian';

interface DiaryMergeSettings {
    diaryFolder: string;
    backupFolder: string;
    dateFormat: string;
    maxEntriesPerFile: number;
    autoMerge: boolean;
    mergeAction: 'backup' | 'delete';
}

const DEFAULT_SETTINGS: DiaryMergeSettings = {
    diaryFolder: 'system/Diary',
    backupFolder: 'system/Diary/bak',
    dateFormat: 'YYYY-MM-DD',
    maxEntriesPerFile: 10,
    autoMerge: false,
    mergeAction: 'backup'
};

export default class DiaryMergerPlugin extends Plugin {
    settings: DiaryMergeSettings;
    isMerging: boolean = false;

    async onload() {
        await this.loadSettings();

        this.addRibbonIcon('files', '合并日记', () => {
            if (!this.isMerging) this.mergeDiaries();
        });

        this.addCommand({
            id: 'merge-diaries',
            name: '合并日记',
            callback: () => {
                if (!this.isMerging) this.mergeDiaries();
            }
        });

        this.addSettingTab(new DiaryMergeSettingTab(this.app, this));
        
        if (this.settings.autoMerge) {
            this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => {
                if (file instanceof TFile && file.parent?.path === this.settings.diaryFolder) {
                    this.autoMergeIfNeeded();
                }
            }));
        }
    }

    // 自动合并检查 - 修复逻辑
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
                new Notice('自动合并日记中...');
                
                // 只合并最早的一组文件（达到合并阈值的部分）
                const batchSize = this.settings.maxEntriesPerFile;
                const batchToMerge = files.slice(0, batchSize);
                
                await this.processBatch(batchToMerge);
            }
        } catch (error) {
            console.error('自动合并失败:', error);
            new Notice('自动合并失败，请查看控制台');
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
                new Notice('没有需要合并的日记文件');
                return;
            }

            // 首次合并时询问操作方式
            if (!this.settings.mergeAction) {
                const action = await this.askForAction();
                if (!action) return;
                this.settings.mergeAction = action;
                await this.saveSettings();
            }

            // 将文件分成多个批次
            const batches = this.splitIntoBatches(files, this.settings.maxEntriesPerFile);
            
            for (const batch of batches) {
                await this.processBatch(batch);
            }
            
            new Notice(`共创建 ${batches.length} 个合并文件`);
        } catch (error) {
            console.error('合并失败:', error);
            new Notice('合并失败，请查看控制台');
        } finally {
            this.isMerging = false;
        }
    }

    // 获取日记文件列表（今天之前的）
    async getDiaryFiles(): Promise<TFile[]> {
        const diaryFolder = this.app.vault.getAbstractFileByPath(this.settings.diaryFolder);
        if (!(diaryFolder instanceof TFolder)) {
            new Notice(`日记文件夹不存在: ${this.settings.diaryFolder}`);
            return [];
        }

        const today = window.moment().format(this.settings.dateFormat);
        
        return diaryFolder.children
            .filter((file): file is TFile => file instanceof TFile && file.name.endsWith('.md'))
            .filter(file => {
                const dateStr = file.basename;
                // 只包括今天之前的有效日期文件
                return dateStr !== today && window.moment(dateStr, this.settings.dateFormat, true).isValid();
            })
            .sort((a, b) => a.name.localeCompare(b.name)); // 按日期排序
    }

    // 从文件名中提取日期
    extractDateFromFilename(filename: string): string | null {
        const dateRegex = /(\d{4}-\d{2}-\d{2})/;
        const match = filename.match(dateRegex);
        return match ? match[1] : null;
    }

    // 询问处理方式
    async askForAction(): Promise<'backup' | 'delete' | null> {
        return new Promise((resolve) => {
            const container = document.createElement('div');
            container.addClass('diary-merge-modal');
            
            container.createEl('h3', { text: '如何处理日记文件？' });
            
            const backupBtn = container.createEl('button', {
                text: '备份后删除',
                cls: 'mod-cta'
            });
            backupBtn.onclick = () => {
                resolve('backup');
                container.remove();
            };
            
            container.createEl('br');
            
            const deleteBtn = container.createEl('button', {
                text: '直接删除',
                cls: 'mod-warning'
            });
            deleteBtn.onclick = () => {
                resolve('delete');
                container.remove();
            };
            
            container.createEl('br');
            
            const cancelBtn = container.createEl('button', { text: '取消' });
            cancelBtn.onclick = () => {
                resolve(null);
                container.remove();
            };
            
            document.body.appendChild(container);
        });
    }

    // 处理一个批次的文件
    async processBatch(batch: TFile[]) {
        if (batch.length === 0) return;
        
        // 计算当前批次的日期范围
        const firstFileDate = this.extractDateFromFilename(batch[0].name);
        const lastFileDate = this.extractDateFromFilename(batch[batch.length - 1].name);
        
        if (!firstFileDate || !lastFileDate) {
            new Notice('无法从文件名中提取日期');
            return;
        }
        
        // 创建合并文件
        const mergedFileName = `merged-${firstFileDate}_to_${lastFileDate}.md`;
        const mergedFilePath = `${this.settings.diaryFolder}/${mergedFileName}`;
        
        // 创建合并内容
        let mergedContent = '';
        for (const file of batch) {
            const content = await this.app.vault.read(file);
            mergedContent += `# ${file.basename}\n\n${content}\n\n`;
        }
        
        // 创建或覆盖合并文件
        await this.app.vault.create(mergedFilePath, mergedContent);
        
        // 备份当前批次（如果需要）
        if (this.settings.mergeAction === 'backup') {
            await this.backupFiles(batch);
        }
        
        // 删除原始文件
        if (this.settings.mergeAction === 'delete' || this.settings.mergeAction === 'backup') {
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
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

        containerEl.createEl('h2', { text: '日记合并设置' });

        new Setting(containerEl)
            .setName('日记文件夹路径')
            .setDesc('存储日记文件的文件夹路径')
            .addText(text => text
                .setPlaceholder('例如: system/Diary')
                .setValue(this.plugin.settings.diaryFolder)
                .onChange(async (value) => {
                    this.plugin.settings.diaryFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('备份文件夹路径')
            .setDesc('备份日记的文件夹路径')
            .addText(text => text
                .setPlaceholder('例如: system/Diary/backups')
                .setValue(this.plugin.settings.backupFolder)
                .onChange(async (value) => {
                    this.plugin.settings.backupFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('日期格式')
            .setDesc('日记文件的日期格式 (使用moment.js格式)')
            .addText(text => text
                .setPlaceholder('例如: YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('每文件最大条目数')
            .setDesc('每个合并文件中包含的最大日记条目数')
            .addSlider(slider => slider
                .setLimits(1, 100, 1)
                .setValue(this.plugin.settings.maxEntriesPerFile)
                .onChange(async (value) => {
                    this.plugin.settings.maxEntriesPerFile = value;
                    await this.plugin.saveSettings();
                })
                .setDynamicTooltip());

        new Setting(containerEl)
            .setName('启用自动合并')
            .setDesc('当日记数量达到阈值时自动合并旧日记')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoMerge)
                .onChange(async (value) => {
                    this.plugin.settings.autoMerge = value;
                    await this.plugin.saveSettings();
                    
                    if (value) {
                        this.plugin.registerEvent(this.plugin.app.vault.on('create', (file: TAbstractFile) => {
                            if (file instanceof TFile && file.parent?.path === this.plugin.settings.diaryFolder) {
                                this.plugin.autoMergeIfNeeded();
                            }
                        }));
                    }
                }));

        new Setting(containerEl)
            .setName('默认处理方式')
            .setDesc('合并后对原日记的处理方式')
            .addDropdown(dropdown => dropdown
                .addOption('backup', '备份后删除')
                .addOption('delete', '直接删除')
                .setValue(this.plugin.settings.mergeAction)
                .onChange(async (value: 'backup' | 'delete') => {
                    this.plugin.settings.mergeAction = value;
                    await this.plugin.saveSettings();
                }));
    }
}