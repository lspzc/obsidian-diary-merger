import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, TAbstractFile} from 'obsidian';

// 定义插件设置接口
interface DiaryMergeSettings {
    diaryFolder: string;
    backupFolder: string;
    dateFormat: string;
    maxEntriesPerFile: number;
    autoMerge: boolean;
    mergeAction: 'backup' | 'delete';
    mergeStrategy: 'append' | 'new';
}

// 默认设置
const DEFAULT_SETTINGS: DiaryMergeSettings = {
    diaryFolder: 'system/Diary',
    backupFolder: 'system/Diary/bak',
    dateFormat: 'YYYY-MM-DD',
    maxEntriesPerFile: 10,
    autoMerge: false,
    mergeAction: 'backup',
    mergeStrategy: 'append'
};

export default class DiaryMergerPlugin extends Plugin {
    settings: DiaryMergeSettings;

    async onload() {
        // 加载设置
        await this.loadSettings();

        // 添加侧边栏按钮
        this.addRibbonIcon('files', '合并日记', () => {
            this.mergeDiaries();
        });

        // 添加命令
        this.addCommand({
            id: 'merge-diaries',
            name: '合并日记',
            callback: () => {
                this.mergeDiaries();
            }
        });

        // 添加设置选项卡
        this.addSettingTab(new DiaryMergeSettingTab(this.app, this));
        
        // 如果启用自动合并，则监听文件创建事件
        if (this.settings.autoMerge) {
            this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => {
                if (file instanceof TFile && file.parent?.path === this.settings.diaryFolder) {
                    this.autoMergeIfNeeded();
                }
            }));
        }
    }

    // 自动合并检查
    async autoMergeIfNeeded() {
        const files = await this.getDiaryFiles();
        if (files.length >= this.settings.maxEntriesPerFile) {
            new Notice('自动合并日记中...');
            await this.performMerge();
        }
    }

    // 主合并函数
    async mergeDiaries() {
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
        }

        // 非首次合并时询问策略
        if (!this.settings.mergeStrategy) {
            const strategy = await this.askForStrategy();
            if (!strategy) return;
            this.settings.mergeStrategy = strategy;
        }

        await this.saveSettings();
        await this.performMerge();
    }

    // 获取日记文件列表
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
                return dateStr !== today && window.moment(dateStr, this.settings.dateFormat, true).isValid();
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    // 从文件名中提取日期
    extractDateFromFilename(filename: string): string | null {
        const dateRegex = /(\d{4}-\d{2}-\d{2})/;
        const match = filename.match(dateRegex);
        return match ? match[1] : null;
    }

    // 从合并文件名中提取日期范围
    extractDateRangeFromMergedFilename(filename: string): { startDate: string, endDate: string } | null {
        const rangeRegex = /merged-(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.md/;
        const match = filename.match(rangeRegex);
        if (match && match.length === 3) {
            return {
                startDate: match[1],
                endDate: match[2]
            };
        }
        return null;
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

    // 询问合并策略
    async askForStrategy(): Promise<'append' | 'new' | null> {
        return new Promise((resolve) => {
            const container = document.createElement('div');
            container.addClass('diary-merge-modal');
            
            container.createEl('h3', { text: '如何合并日记？' });
            
            const appendBtn = container.createEl('button', {
                text: '追加到现有合并文件',
                cls: 'mod-cta'
            });
            appendBtn.onclick = () => {
                resolve('append');
                container.remove();
            };
            
            container.createEl('br');
            
            const newBtn = container.createEl('button', {
                text: '创建新的合并文件'
            });
            newBtn.onclick = () => {
                resolve('new');
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

    // 执行合并操作
    async performMerge() {
        const files = await this.getDiaryFiles();
        if (files.length === 0) return;

        // 计算本次合并的日期范围
        const firstDate = this.extractDateFromFilename(files[0].name);
        const lastDate = this.extractDateFromFilename(files[files.length - 1].name);
        
        if (!firstDate || !lastDate) {
            new Notice('无法从文件名中提取日期');
            return;
        }

        // 备份文件（如果需要）
        if (this.settings.mergeAction === 'backup') {
            await this.backupFiles(files);
        }

        // 获取或创建合并文件
        let mergedFile: TFile;
        let mergedContent = '';
        let currentStartDate = firstDate;
        let currentEndDate = lastDate;
        
        // 查找现有的合并文件
        const existingMergedFiles = this.getExistingMergedFiles();
        
        if (this.settings.mergeStrategy === 'append' && existingMergedFiles.length > 0) {
            // 使用现有的合并文件
            mergedFile = existingMergedFiles[0];
            
            // 读取现有内容
            mergedContent = await this.app.vault.read(mergedFile);
            
            // 更新日期范围
            const dateRange = this.extractDateRangeFromMergedFilename(mergedFile.name);
            if (dateRange) {
                // 比较日期并扩展范围
                currentStartDate = this.getEarlierDate(dateRange.startDate, firstDate);
                currentEndDate = this.getLaterDate(dateRange.endDate, lastDate);
            }
        } else {
            // 创建新的合并文件
            const newFileName = `merged-${firstDate}_to_${lastDate}.md`;
            const newFilePath = `${this.settings.diaryFolder}/${newFileName}`;
            mergedFile = await this.app.vault.create(newFilePath, '');
        }

        // 添加新内容
        for (const file of files) {
            const content = await this.app.vault.read(file);
            const header = `# ${file.basename}\n\n`;
            mergedContent += header + content + '\n\n';
        }
        
        // 写入更新后的内容
        await this.app.vault.modify(mergedFile, mergedContent);
        
        // 更新文件名（如果需要）
        const newFileName = `merged-${currentStartDate}_to_${currentEndDate}.md`;
        if (mergedFile.name !== newFileName) {
            const newPath = `${this.settings.diaryFolder}/${newFileName}`;
            await this.app.vault.rename(mergedFile, newPath);
        }
        
        // 删除原始文件
        if (this.settings.mergeAction === 'delete' || this.settings.mergeAction === 'backup') {
            for (const file of files) {
                await this.app.vault.delete(file);
            }
        }
        
        new Notice(`已合并 ${files.length} 篇日记到 ${newFileName}`);
    }

    // 获取所有现有的合并文件
    getExistingMergedFiles(): TFile[] {
        const diaryFolder = this.app.vault.getAbstractFileByPath(this.settings.diaryFolder);
        if (!(diaryFolder instanceof TFolder)) return [];
        
        return diaryFolder.children
            .filter((file): file is TFile => file instanceof TFile)
            .filter(file => file.name.startsWith('merged-') && file.name.endsWith('.md'));
    }

    // 比较两个日期，返回较早的日期
    getEarlierDate(date1: string, date2: string): string {
        const moment1 = window.moment(date1, this.settings.dateFormat);
        const moment2 = window.moment(date2, this.settings.dateFormat);
        return moment1.isBefore(moment2) ? date1 : date2;
    }

    // 比较两个日期，返回较晚的日期
    getLaterDate(date1: string, date2: string): string {
        const moment1 = window.moment(date1, this.settings.dateFormat);
        const moment2 = window.moment(date2, this.settings.dateFormat);
        return moment1.isAfter(moment2) ? date1 : date2;
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

    // 加载设置
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    // 保存设置
    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// 设置选项卡
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

        // 日记文件夹设置
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

        // 备份文件夹设置
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

        // 日期格式设置
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

        // 每文件最大条目数
        new Setting(containerEl)
            .setName('每文件最大条目数')
            .setDesc('每个合并文件中包含的最大日记条目数')
            .addSlider(slider => slider
                .setLimits(5, 100, 5)
                .setValue(this.plugin.settings.maxEntriesPerFile)
                .onChange(async (value) => {
                    this.plugin.settings.maxEntriesPerFile = value;
                    await this.plugin.saveSettings();
                })
                .setDynamicTooltip());

        // 自动合并开关
        new Setting(containerEl)
            .setName('启用自动合并')
            .setDesc('当日记数量达到阈值时自动合并')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoMerge)
                .onChange(async (value) => {
                    this.plugin.settings.autoMerge = value;
                    await this.plugin.saveSettings();
                    
                    // 如果启用自动合并，注册文件创建监听器
                    if (value) {
                        this.plugin.registerEvent(this.plugin.app.vault.on('create', (file: TAbstractFile) => {
                            if (file instanceof TFile && file.parent?.path === this.plugin.settings.diaryFolder) {
                                this.plugin.autoMergeIfNeeded();
                            }
                        }));
                    }
                }));

        // 默认处理方式
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

        // 默认合并策略
        new Setting(containerEl)
            .setName('默认合并策略')
            .setDesc('如何合并到现有文件')
            .addDropdown(dropdown => dropdown
                .addOption('append', '追加到现有文件')
                .addOption('new', '创建新文件')
                .setValue(this.plugin.settings.mergeStrategy)
                .onChange(async (value: 'append' | 'new') => {
                    this.plugin.settings.mergeStrategy = value;
                    await this.plugin.saveSettings();
                }));
    }
}