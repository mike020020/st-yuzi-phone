## Agent skills

### Issue tracker

本项目的需求规格和开发任务只记录为本地 Markdown 文件，不发布到远程平台。详细规则见 `docs/agents/issue-tracker.md`。

### Interview records

只有用户明确调用 `$grill-me` 或 `$grill-with-docs` 时，才能创建或更新 `.scratch/<feature-slug>/interview-notes.md`，并逐字记录可见的 Codex 问题与用户回答。普通需求讨论、设计讨论、直接实现，或自然语言要求“问几个问题”均不得写入 `.scratch/`。访谈不得创建或更新 `spec.md`；只有用户明确调用 `$to-spec` 后才能创建或更新正式规格，只有用户明确调用 `$to-tickets` 后才能创建或更新任务文件。详细规则见 `docs/agents/issue-tracker.md`。

### Domain docs

本项目采用单一领域上下文。领域术语与架构决策的读取规则见 `docs/agents/domain.md`。


