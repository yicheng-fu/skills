---
name: zotero-better-note-summary
description: 为给定 Zotero 论文条目创建或完善 Better Note 风格的 Markdown 总结笔记。用于用户要求在 Zotero 中为某篇论文生成简洁清晰的中文总结时，尤其适用于需要先确认 Better Notes 与本地 bridge 插件可用、检查论文下是否已有总结、再按“研究动机”“研究内容”“核心技术或核心结论”三部分各写一段并提炼具体关键结论或技术的场景。
---

# Zotero Better Note Summary

## Overview

为单篇论文生成或完善可直接用于 Zotero Better Notes 的 Markdown 笔记，并在可用时自动把笔记创建或更新到 Zotero 的目标论文条目下。默认使用中文，输出三段式总结，每一部分只写一段，优先做到信息密度高、表达直白、便于快速回顾。

优先使用 Zotero Better Notes 插件和本 skill 自带的本地桥接脚本完成自动创建或更新；只有在用户明确接受纯文本草稿时，才退回到输出一份可直接粘贴到 Better Notes 的 Markdown 正文。

## Automation Setup

在正式总结前，必须先确认 Zotero Better Notes 插件和本 skill 的 Codex Zotero Bridge 插件都已安装并可用。先检查 Zotero 桥接：

```bash
python3 scripts/zotero_bridge.py ping
```

若命令成功返回 JSON，且 `betterNotesAvailable` 为 `true`，说明 Better Notes 和 bridge 都可用，可以直接读写 Zotero。

若命令超时或报错，说明 bridge 不可用。先构建并安装本 skill 附带的 Zotero bridge 插件：

```bash
python3 scripts/build_zotero_bridge_xpi.py
```

这会生成 `assets/codex-zotero-bridge.xpi`。帮助用户把该文件安装到 Zotero 的 Add-ons 或 Zotero profile 的 `extensions/` 目录中，然后重启 Zotero，再重新运行 `ping` 确认可用。插件源码位于 [assets/zotero-codex-bridge/bootstrap.js](./assets/zotero-codex-bridge/bootstrap.js) 和 [assets/zotero-codex-bridge/manifest.json](./assets/zotero-codex-bridge/manifest.json)。

若 `ping` 成功但 `betterNotesAvailable` 为 `false`，说明 Better Notes 没有安装、没有启用，或尚未在当前 Zotero 会话中加载。先帮助用户安装或启用 Better Notes 并重启 Zotero；在 `betterNotesAvailable: true` 前，不要默认创建“Better Note 风格”的正式 note，除非用户明确只要一份可粘贴的 Markdown 草稿。

桥接就绪后，使用 [scripts/zotero_bridge.py](./scripts/zotero_bridge.py) 完成以下操作：

- 读取当前选中的 Zotero 论文条目
- 检查该论文下是否已有总结 note
- 把最终 Markdown 总结自动创建为该论文下的子 note
- 在用户确认后把完善后的 Markdown 写回已有总结 note

## Workflow

### 1. 确认输入范围

先确认当前任务是“单篇论文总结”，而不是文献综述或多篇比较。若用户没有额外要求，默认：

- 输出语言为中文
- 输出形式为 Better Note 兼容的 Markdown
- 输出对象为当前给定论文
- 输出目标为快速回顾论文核心价值，而不是长篇解读

如果用户显式要求英文或其他结构，按用户要求覆盖默认行为。

若用户没有显式给出 Zotero item key，且桥接可用，则默认以 Zotero 当前选中的单篇论文作为目标对象。先运行：

```bash
python3 scripts/zotero_bridge.py get-selected-item
```

若未选中条目、选中了多个条目，或返回对象不是单篇论文的顶层条目，则先纠正目标对象。

### 2. 检查已有论文总结

确认目标论文后，先检查该论文下是否已有论文总结 note：

```bash
python3 scripts/zotero_bridge.py list-notes --selected --include-content
```

若用户提供了明确的 Zotero item key，则改用：

```bash
python3 scripts/zotero_bridge.py list-notes --parent-key ITEMKEY --include-content
```

将标题或正文中包含 `论文总结`、`研究动机`、`研究内容`、`核心技术`、`核心结论`、`summary` 等特征的 note 视为候选已有总结。若找到候选，先询问用户是否基于已有总结修改完善，还是新建一条总结 note。询问时列出候选 note 的标题、key 和一句判断理由。

若用户选择修改已有总结，先阅读该 note 的 `noteText`，保留其已有有价值内容，在此基础上补充更具体的关键结论、技术细节和必要的结构调整。除非用户明确要求覆盖，不要直接丢弃原总结；写回前要确认目标 note key。

### 3. 提取论文关键信息

优先从用户提供的信息，或由 Zotero 桥接返回的标题、摘要、作者、年份、附件路径中提取关键信息，并围绕以下问题归纳：

- 这篇论文为什么值得做，试图解决什么问题
- 这篇论文具体做了什么，研究对象和方法范围是什么
- 这篇论文最核心的技术点是什么，或最关键的结论是什么
- 方法型论文：具体模型、模块、训练目标、优化策略、推断流程、数据构造或系统设计是什么
- 结论型论文：最关键的实证发现、因果/机制解释、适用条件、反例或局限是什么

若桥接返回 `bestAttachment.path` 且总结质量明显依赖正文细节，应优先进一步读取该 PDF 或附件，尤其是方法、实验设置、结果表和结论部分；否则根据标题、摘要和已有元数据给出简洁总结。

如果只能看到摘要或部分信息，明确按“基于摘要”或“基于可见内容”总结，不要把推断写成确定事实。

### 4. 选择第三段的表述方式

根据论文类型，在以下两种写法中二选一：

- 方法型、模型型、系统型论文：使用“核心技术”
- 发现型、分析型、实验型、理论型论文：使用“核心结论”

不要为了保持模板僵硬而误用“核心技术”。若论文的价值主要来自发现、结论或实证结果，就写“核心结论”。

### 5. 生成三段式总结

严格输出以下三部分，每部分各一段，不拆成列表：

- `## 研究动机`
- `## 研究内容`
- `## 核心技术` 或 `## 核心结论`

写作要求：

- 每段只写一个自然段
- 默认每段 2 到 4 句，优先简洁
- 优先解释“做什么”“怎么做”“结论是什么”和“为什么重要”，不要堆术语
- 必须提炼至少 2 到 4 个具体信息点，嵌入自然段中，而不是停留在“提出新方法”“验证有效性”这类概括
- 方法型论文要点名关键机制、模块、目标函数、训练/推断流程或设计取舍；结论型论文要点名主要发现、适用条件、边界和局限
- 若论文有明确实验结论，优先写出在哪类数据、任务、指标或对照下得到什么结论；不要只写“表现更好”
- 避免空话，如“具有重要意义”“效果显著提升”这类无信息密度表述
- 避免照抄摘要，改写为更适合回顾的语言
- 除非用户要求，不要添加额外章节、表格、项目符号或冗长引用

### 6. 使用 Better Note 友好的 Markdown

默认输出正文使用如下结构：

```md
## 研究动机
...

## 研究内容
...

## 核心技术
...
```

若第三部分更适合写结论，则将最后一个标题替换为 `## 核心结论`。

若桥接可用，优先自动创建 note，而不是只返回文本。推荐流程：

1. 将最终总结写入临时 Markdown 文件。
2. 若用户选择新建 note，调用桥接脚本创建 note：

```bash
python3 scripts/zotero_bridge.py create-note --selected --markdown-file /tmp/paper-summary.md --title "论文总结" --open
```

若用户提供了明确的 Zotero item key，则改用：

```bash
python3 scripts/zotero_bridge.py create-note --parent-key ITEMKEY --markdown-file /tmp/paper-summary.md --title "论文总结" --open
```

3. 若用户选择更新已有 note，调用桥接脚本更新 note：

```bash
python3 scripts/zotero_bridge.py update-note --note-key NOTEKEY --markdown-file /tmp/paper-summary.md --title "论文总结" --open
```

`--title "论文总结"` 会在正文前补一个顶层标题，目的是让 Zotero 中的 note 列表有稳定标题；不要把这个标题当作三段总结的一部分。

若桥接不可用且用户明确接受纯文本草稿，则直接返回 Markdown 内容，不要额外包裹解释性前言，并明确说明需要先安装桥接插件后才能自动写入 Zotero。

## Resources

### scripts/

- [scripts/zotero_bridge.py](./scripts/zotero_bridge.py)：Codex 侧桥接客户端。用于检测桥接状态、读取当前选中的论文、列出已有子 note、创建或更新 Better Note。
- [scripts/build_zotero_bridge_xpi.py](./scripts/build_zotero_bridge_xpi.py)：将本 skill 自带的 Zotero 插件源码打包为 `.xpi`。

### assets/

- [assets/zotero-codex-bridge/bootstrap.js](./assets/zotero-codex-bridge/bootstrap.js)：安装到 Zotero 内部的桥接插件主体。负责轮询 `/tmp/zotero-codex-bridge` 请求并读取、创建或更新 note。
- [assets/zotero-codex-bridge/manifest.json](./assets/zotero-codex-bridge/manifest.json)：桥接插件清单。

## Output Standard

交付前检查以下几点：

- 三个部分是否齐全，且各自只有一段
- 语言是否简洁清楚，能让人一眼抓住重点
- “研究动机”是否回答了为什么做
- “研究内容”是否回答了做了什么
- “核心技术或核心结论”是否抓住了最值得记住的具体创新点、机制、实验发现或边界条件，而不是泛泛概括
- 是否已检查 Better Notes 和 bridge 均可用，或已明确告知用户只能生成可粘贴草稿
- 是否已检查目标论文下已有总结 note，并在发现候选时询问用户修改还是新建
- 是否避免了明显冗余、套话和无依据推断
- 若桥接可用，是否已经实际在 Zotero 中创建或更新了子 note，而不是只停留在终端输出

若论文信息不足，明确说明信息边界，但仍尽量给出可用的精炼总结。
