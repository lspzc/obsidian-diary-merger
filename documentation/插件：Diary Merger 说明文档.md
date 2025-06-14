---
author: lspzc
tags:
  - obsidian
  - obsidian插件开发
state: doing
number headings:
  - auto, first-level 1, max 6, _.1.1
created: 2025-06-04T14:11:25+08:00
updated: 2025-06-06T09:14:50+08:00
---

## 1 是什么

一个 obsidian 插件

插件功能：按照阈值与条目数 `自动/手动` 合并或追加多个日记文件至一个或多个合并文件中。

## 2 为什么

我的痛点：

我是将 obsidian 日记功能通过 task，dataview 等插件作为 todo 项管理使用的，但逐渐我发现一个问题，我每天的 todo 可能只有三四条，**但我的日记文件却有上百个**（一天一篇日记嘛）

当然，你可以维护一个文件，在里边写 todo，先不说看起来乱糟糟，一直在一个文件中写，写的多了还是要慢慢向下翻的，最重要的是，只需要点击一下日记按钮，就可以在一个全新的文件中书写，感觉超棒的有木有~

所以，我需要一个插件，自动帮我合并今天之前的日记（笔记完成或未完成的 todo 也是需要被查询出来的）至一个文件中

## 3 怎么用

### 3.1 插件环境

插件开发测试环境：window11系统，obsidian 版本 1.8.10

由于本人没有 mac 设备，所以未作测试，**建议先找一个测试库试一试**

移动端未测试

### 3.2 下载插件

目前插件尚未上架插件市场，目前需要自行下载插件

GitHub 地址：[lspzc/obsidian-diary-merger](https://github.com/lspzc/obsidian-diary-merger)

Gitee 地址：[lspzc/obsidain分享](https://gitee.com/lspzc/obsidain-share)
### 3.3 安装插件

这里不过多介绍，可以参考：[PKMer_Obsidian 社区插件的安装](https://pkmer.cn/Pkmer-Docs/10-obsidian/obsidian%E7%A4%BE%E5%8C%BA%E6%8F%92%E4%BB%B6/obsidian%E7%A4%BE%E5%8C%BA%E6%8F%92%E4%BB%B6%E7%9A%84%E5%AE%89%E8%A3%85/#%E6%89%8B%E5%8A%A8%E5%AE%89%E8%A3%85) 中的手动安装

### 3.4 插件设置

安装好插件后，首先要设置路径参数，将前三个路径改为自己的路径

![](attachments/插件：Diary%20Merger%20说明文档-img-1.png)

**日记文件名称格式**：建议使用 obsidian 默认格式：YYYY-MM-DD，其他格式未经测试

**合并文件最大条目数**：每个合并文件最大可以合并多少篇日记，这里可以调高一点，比如30，一个月的日记合并成一篇文档

**自动合并阈值**：自动合并的触发参数，也就是你希望今天以前有多少篇日记时会触发自动合并，看你个人喜好，一周合并一次就设置为7，我个人希望一天就合并一次，嘿嘿，日记文件夹内清清爽爽~

**启用自动合并**：这个不必多说字面意思，需要注意的是，触发自动合并需要满足三个条件，少一个都不行分别是：`开启了自动合并` 与 `今天以前的日记数量达到设置的自动合并阈值` 与 `在日记文件路径创建了今天的日记`

**默认处理方式**：建议备份，使用一段时间后，觉得插件比较稳定了，再使用永久删除，这个永久删除系统回收站是没有的，是真的会永久删除~

**关闭操作提示**：也就是 obsidian 右上角的提示，会提示合并了多少日记，合并文件有几个，追加了多少日记等等，建议先打开，可以知道插件干了什么事，等熟悉插件后，再关闭提示。注意，一些报错提示并不能通过这个选项关闭，如："警告：请不要创建未来的日记文件！"，"没有需要合并的日记文件"，"日记文件夹不存在"等等。

### 3.5 插件使用介绍

接下来，就是正式的使用环节，期待~

举个🌰：

这里有 `2025-05-21` 至 `2025-06-05` 14篇笔记（今天是 2025-06-05 ），日记中间可以少天数，不必每一天都要有笔记，（注意，演示需要，2025-06-05 目前没有日记）

![](attachments/插件：Diary%20Merger%20说明文档-img-4.png)

设置好三个路径

![](attachments/插件：Diary%20Merger%20说明文档-img-5.png)

设置合并文件最大条目数为 5（演示需要，调小一点）

![](attachments/插件：Diary%20Merger%20说明文档-img-6.png)

#### 3.5.1 手动合并

先将今天的日记删除

点击左侧侧边栏合并按钮，或者 `ctrl + p` 调出 obsidian 命令面板，选择合并日记

![](attachments/插件：Diary%20Merger%20说明文档-img-8.png)

![](attachments/插件：Diary%20Merger%20说明文档-img-3.png)

在弹出的模态框中选择备份后删除

![](attachments/插件：Diary%20Merger%20说明文档-img-7.png)

预计结果为

- 由于没有今天的日记，`system/Diary` 路径下将会没有一篇日记文件
- `system/Diary` 会出现两个文件夹，`mergeds` 合并文件夹与 `backups` 备份文件夹
- `日记总数13/最大合并数5` 也就是说将会出现三个合并文件，且第三个合并文件中只合并了3篇笔记

插件运行后

![](attachments/插件：Diary%20Merger%20说明文档-img-9.png)

可以看到符合预期

注意：

- **合并文件的命名为**，merged-最早的日记_to_最后追加的日记
- 合并文件内，**每一个一级标题，就是合并前日记的标题**，该一级标题与下一个一级标题之间则是该日记原本的内容

![](attachments/插件：Diary%20Merger%20说明文档-img-11.png)

此时我们可以在 `system/Diary` 插入 `2025-06-02` 的日记，并创建今天 `2025-06-05` 的日记

![](attachments/插件：Diary%20Merger%20说明文档-img-12.png)

再次运行插件合并

![](attachments/插件：Diary%20Merger%20说明文档-img-14.png)

可以看到

- **今天的日记**没有被合并
- `2025-06-02` 的日记被**追加**到了最近的一个**未达到最大合并数目**的合并文件中，并且按照合并文件规则，**修改了合并文件的名称**（当然，这里是测试，实际你的日记 06-02 不会在 06-04 之后创建吧）

#### 3.5.2 自动合并

首先，开启自动合并

![](attachments/插件：Diary%20Merger%20说明文档-img-15.png)

设置自动合并阈值为2

![](attachments/插件：Diary%20Merger%20说明文档-img-16.png)

测试前，删除刚才手动合并中创建的今天的日记（由于自动合并需要创建今天的日记触发）

目前文件结构如下图

![](attachments/插件：Diary%20Merger%20说明文档-img-17.png)

此时，由于今天以前的日记数量不满足自动合并阈值，预计创建今天的日记不会触发自动合并

![](attachments/插件：Diary%20Merger%20说明文档-img-18.png)

现在，改变目录结构，使其满足自动合并触发条件，然后创建今天的日记

![](attachments/插件：Diary%20Merger%20说明文档-img-19.png)

预计将会自动发生合并操作，并且最近一个合并文件名称会发生变化

![](attachments/插件：Diary%20Merger%20说明文档-img-20.png)
