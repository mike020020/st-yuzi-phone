# Issue Tracker：本地 Markdown

本项目不向 GitHub 或其他远程平台发布需求与任务。所有规格和任务清单都保存在 `.scratch/` 下的本地 Markdown 文件中。

## 文件约定

- 每个功能使用一个目录：`.scratch/<feature-slug>/`
- 访谈原始记录写入：`.scratch/<feature-slug>/interview-notes.md`
- 功能规格写入：`.scratch/<feature-slug>/spec.md`
- 每个开发任务单独保存为：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- 任务从 `01` 开始编号，并按依赖顺序排列，前置任务排在前面。
- 每个任务文件包含目标、前置依赖、状态和可勾选的验收条件。
- 讨论或补充记录追加在任务文件底部的 `## Comments` 下。

## 访谈原始记录

只有用户在当前对话中明确调用 `$grill-me` 或 `$grill-with-docs` 时，才能开始访谈并创建或更新 `.scratch/<feature-slug>/interview-notes.md`。在提出第一个实质问题前，先逐字记录用户的初始功能请求。

- 不得根据任务内容、用户说“问几个问题”、普通需求讨论、设计讨论或直接实现，自行认定已进入访谈。
- 未发生上述明确调用时，禁止创建目录、文件或修改 `.scratch/` 中的任何内容。
- `interview-notes.md` 只能由明确调用的访谈流程创建或更新；`$to-spec` 不得补写或伪造访谈记录。

- 每一轮都记录完整、可见的 Codex 访谈消息，以及用户的完整回答；保留原有 Markdown、推荐答案和选项文字。
- Codex 在发送下一道问题前，必须先把上一轮用户回答原样追加到记录中；下一道问题也必须原样写入记录后再呈现给用户。
- 记录只保存用户可见的访谈内容，不保存内部推理、工具输出或无关聊天内容。
- 已确认的答案、改口和纠正都按时间追加，绝不回写、概括、润色或删除历史回答。
- 无法取得原文时，明确标记为“原文不可用，需用户重新确认”；绝不根据摘要、记忆或推测补写记录。
- 如果当前模式不能写文件，必须在开始实质访谈前明确说明，等待用户切换到可写模式或同意仅在聊天中继续；不得假装记录已经落盘。

推荐格式：

```markdown
# <功能名> 访谈原始记录

## Turn 000 - Initial request

### User

<用户原始功能请求>

## Turn 001

### Codex

<Codex 原始问题、背景和推荐答案>

### User

<用户原始回答>
```

`interview-notes.md` 是需求事实的原始证据，不是规格，也不是待办清单。允许在聊天中展示摘要，但不得把摘要替换或混入原始记录。

## Skill 操作约定

- `.scratch/` 设有明确调用闸门：除用户明确调用 `$grill-me`、`$grill-with-docs`、`$to-spec` 或 `$to-tickets` 外，任何 Skill、普通任务或工作流均不得创建或更新其中的内容。
- 上述明确调用的 Skill 要求“发布到 Issue Tracker”时，只在 `.scratch/<feature-slug>/` 创建本地文件。
- Skill 要求“读取相关 Ticket”时，直接读取用户提供的本地文件路径或任务编号。
- 只有用户明确调用 `$grill-me` 或 `$grill-with-docs` 时，访谈阶段才能创建或更新 `interview-notes.md`；不得创建、更新或模拟 `spec.md`。
- 只有用户明确调用 `$to-spec` 时，才将当前讨论和 `interview-notes.md` 整理为该功能的 `spec.md`。遇到原始记录与聊天摘要矛盾或缺失时，先请用户确认，不得猜测补全。
- 只有用户明确调用 `$to-tickets` 时，才能将规格拆为一个任务一份文件的本地清单；不得自动创建任务文件，也不创建 GitHub Issue。
- 任务存在依赖关系时，在文件中写 `Blocked by: <编号或标题>`；没有依赖则写明可以立即开始。

`.scratch/` 已加入 `.gitignore`，这些本地任务清单不会被正常的 Git 提交收录。
