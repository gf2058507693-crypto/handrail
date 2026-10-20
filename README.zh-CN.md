# Handrail

**在 GitHub 上做有人工门禁、有真实证据的 AI 研发交付。**

Handrail 是一个命令行研发流程引擎。它让 AI 代理真正参与软件交付，同时保留三件不能被自动化掉的东西：人的判断、需求到代码的追溯链、以及真实执行过的测试证据。

你给它一份产品需求文档（PRD），它会依次完成这些机械工作：登记需求 Issue、整理澄清记录、生成规格 Issue、拆分可独立验收的任务、逐个任务实现和审查、创建可追溯的 Pull Request。每一个需要人负责的节点，它都会停下来。

```text
产品需求
 -> 需求 Issue
 -> 澄清记录
 -> 规格 Issue                 [门禁：spec-approved]
 -> 任务草稿
 -> 已发布任务                 [门禁：tickets-approved]
 -> 实现                       [门禁：已有检查证据]
 -> 独立审查                   [门禁：审查通过]
 -> Pull Request               [门禁：策略检查 + CI]
 -> 人工批准并合并
 -> 整体验收                   [门禁：全部任务已合并]
 -> 复盘
```

Handrail 不会合并 PR，不会绕过分支保护，也不会把一句“测试通过了”变成一条通过记录。

资料包中的 `grill-with-docs`、`to-spec`、`to-tickets`、`implement` + TDD、`code-review`、`pr`、`retro` 分别对应 Handrail 的澄清、规格、任务、实现、审查、PR 与复盘命令。代理负责执行，GitHub 保存正式工件，CI 与人工审查控制合并。使用 Handrail 命令时无需另装 Skills 插件。

---

## 为什么需要 Handrail

AI 编程代理很擅长写代码，但“会写代码”不等于“能交付软件”。常见的问题有六类，Handrail 分别给出了工程化的对策。

| 常见问题 | Handrail 的做法 |
|---|---|
| 需求只存在于聊天记录里 | 把需求固化成 GitHub Issue，记录来源、业务目标、范围、非目标和待确认事项 |
| 代理自行补全不确定的业务规则 | 先做需求澄清，把已确认决策、实现假设和待确认问题分开记录，再写规格 |
| 一个大需求直接丢给代理 | 拆成垂直切片任务，每张任务都有可观察的验收标准和真实依赖 |
| 只看代理说“完成了” | 记录实际执行的命令、退出码、耗时和输出尾部，PR 证据从这些记录生成 |
| 代码审查标准因人而异 | 固定两个审查维度：工程规范（Standards）和规格符合度（Spec） |
| Issue、PR、测试互相脱节 | 维护 `需求 -> 规格 -> 任务 -> PR -> CI` 的追溯链，并在 CI 里检查 |

Handrail 的设计取向和“给一份 PRD 就全自动跑完”的框架相反。它自动化的是重复的机械劳动，保留的是需要人承担责任的判断。这不是能力不足，而是有意为之：在真实团队里，需求解释、规格批准、任务拆分和合并上线都需要明确的责任人。

---

## 核心组成

- 一套 CLI（`handrail`），覆盖需求受理、澄清、规格、任务拆分、实现、审查、PR、验收和复盘。
- 一个仓库脚手架（`handrail init`），会给目标仓库加上 Issue 表单、PR 模板、CODEOWNERS、CI、AI 研发策略检查、`AGENTS.md`、`GLOSSARY.md` 和 ADR 目录。
- 一个可插拔的代理运行时，支持三种后端：
  - `anthropic`：内置的 Anthropic Messages API 循环，带读写文件、列文件、搜索和执行命令工具。
  - `command`：外部代理命令行工具，比如 Claude Code 或 Codex，通过标准输入接收提示词。
  - `mock`：确定性的测试用代理，不调用模型。
- 一个证据库，把每条命令的退出码、耗时和输出尾部记录到 `.handrail/evidence/`。
- 一个策略检查，在 PR 缺少追溯链接、缺少人工批准或缺少真实证据时让 CI 失败。

---

## 环境要求

- Node.js 20 或更高版本
- Git
- GitHub CLI（`gh`），并且已经完成认证（凡是需要访问 GitHub 的命令都依赖它）
- 一个 Anthropic API Key，或者一个可用的外部代理命令

---

## 安装

从源码安装：

```bash
git clone https://github.com/gf2058507693-crypto/handrail.git
cd handrail
npm install
npm run build
npm link
```

执行 `npm link` 之后，终端里就可以直接使用 `handrail` 命令。

---

## 快速开始

### 第一步：在目标仓库里初始化

```bash
cd 你的仓库
handrail init
```

它会自动识别项目的构建和测试命令，并生成这些文件：

```text
.handrail/config.json
AGENTS.md
GLOSSARY.md
docs/adr/0001-record-architecture-decisions.md
docs/ai-workflow.md
.github/ISSUE_TEMPLATE/feature.yml
.github/ISSUE_TEMPLATE/bug.yml
.github/PULL_REQUEST_TEMPLATE.md
.github/CODEOWNERS
.github/scripts/policy.mjs
.github/workflows/ci.yml
.github/workflows/ai-dev-policy.yml
```

然后创建流程标签并检查环境：

```bash
handrail init --github
handrail doctor
```

接着请到 GitHub 仓库设置里配置分支保护或 Rulesets，要求主分支只能通过 PR 合并、必须有独立审批、必须通过 `CI` 和 `AI development policy` 两个检查。Handrail 会提醒你做这件事，但不会偷偷修改仓库权限设置，因为这类设置应该由仓库管理员明确决定。

### 第二步：配置代理

使用内置 Anthropic 后端：

```bash
export ANTHROPIC_API_KEY="你的密钥"
```

或者使用外部代理命令：

```json
{
  "agent": {
    "provider": "command",
    "command": ["claude", "-p"]
  }
}
```

Handrail 会把完整提示词写到该命令的标准输入，并读取标准输出作为结果。任何“从标准输入读提示词、把回答写到标准输出”的代理 CLI 都可以接入。

### 第三步：跑完整流程

```bash
# 1. 从 PRD 创建需求 Issue
handrail intake --prd PRD.md --title "订单批量导入支持失败记录重试"

# 可选：先调查外部提交或信息不完整的 Issue
handrail triage 100 --apply

# 2. 需求澄清。交互模式会一次只问一个关键问题。
handrail clarify --interactive --comment --write-docs

# 3. 生成规格草稿，然后由人批准
handrail spec
handrail approve spec 101

# 4. 生成任务草稿，人工检查拆分，批准后发布
handrail tickets 101
handrail approve tickets 101
handrail publish tickets 101

# 5. 逐个任务实现、审查、创建 PR
handrail implement 102
handrail review 102
handrail pr 102 --create

# 6. 到这里停下。由人检查 CI、审批并合并 PR。
```

所有任务合并后：

```bash
handrail accept 101 --close
handrail retro 101
```

如果希望 Handrail 按依赖顺序自动推进，并在每个合并门禁处停下：

```bash
handrail run 101
```

---

## 命令一览

| 命令 | 作用 |
|---|---|
| `handrail init [dir]` | 生成流程文件、识别检查命令、可选创建标签 |
| `handrail doctor` | 检查 Node、配置、Git、`gh`、认证、标签、检查命令和代理凭据 |
| `handrail intake --prd <file>` | 创建需求 Issue |
| `handrail triage <issue> [--apply]` | 调查重复工单、现有行为和缺失信息；可选写回结论与标签 |
| `handrail clarify [issue]` | 记录决策、假设与待确认问题；`--write-docs` 写入术语和待审批 ADR |
| `handrail spec [requirement]` | 创建关联需求的规格 Issue |
| `handrail approve spec <issue>` | 添加 `spec-approved` 标签，并记录批准人和规格正文哈希 |
| `handrail tickets [spec]` | 生成垂直切片任务草稿，校验依赖图 |
| `handrail approve tickets <spec>` | 添加 `tickets-approved` 标签，并记录草稿哈希 |
| `handrail publish tickets <spec>` | 真正创建任务 Issue |
| `handrail implement <ticket>` | 建分支、运行代理、执行检查、提交、运行独立审查 |
| `handrail review <ticket>` | 以固定比较点为基准，按 Standards 和 Spec 两个维度审查 |
| `handrail pr <ticket> --create` | 推送分支并创建带追溯链接和证据的 PR |
| `handrail status [spec]` | 显示追溯链和门禁状态 |
| `handrail trace [requirement]` | 打印 `需求 -> 规格 -> 任务 -> PR` 链 |
| `handrail accept [spec]` | 校验全部任务已合并、CI 全绿，然后做整体验收 |
| `handrail retro [spec]` | 基于真实证据生成复盘报告 |
| `handrail run [spec]` | 按依赖顺序实现任务，在每个合并门禁处停下 |

全局选项有 `-C, --cwd <dir>`、`-v, --verbose` 和 `--json`。

---

## 门禁

Handrail 的门禁不是写在提示词里“请遵守”，而是落实在标签、代码检查和 CI 中。

| 门禁 | 由什么强制 | 防止什么 |
|---|---|---|
| 规格就绪 | `spec-approved` 标签，在拆任务和实现前检查 | 按未评审的规格开工 |
| 任务就绪 | `tickets-approved` 标签，在发布和实现前检查 | 按未评审的拆分开工 |
| 检查有证据 | 当前提交上每条配置检查的最新结果，在创建 PR 前检查 | 没为当前改动跑测试却声称通过 |
| 审查通过 | 与当前提交绑定的审查结果，在创建 PR 前检查 | 重用过期的审查记录 |
| 可以合并 | GitHub 分支保护、CI、CODEOWNERS | 自己批准自己、CI 失败仍合并、直接推主分支 |
| 整体验收 | 所有任务已关闭、所有关联 PR 已合并、CI 全绿 | 父级 Issue 在还有未完成工作时被关闭 |

`ready-for-agent` 故意不作为审批标签。它只表示“输入已经整理好，代理可以开始工作”，不代表人已经批准。

---

## 证据模型

Handrail 记录的每一条证据都来自一次真实执行：

```json
{
  "kind": "check",
  "ticket": 102,
  "command": "npm test",
  "exitCode": 0,
  "durationMs": 8123,
  "timestamp": "2026-10-20T09:00:00.000Z",
  "stdoutTail": "..."
}
```

PR 描述里的 Evidence 表格由这些记录生成。如果没有执行过任何检查，PR 会明确写“没有记录到命令”，策略检查会让 CI 失败。代码里不存在“把代理的一句话当成测试通过”的路径。

对于复杂业务规则、关键计算和 Bug 修复，实现提示词要求在 Spec 约定的测试边界采用 Red → Green → Refactor。CLI 提交改动后执行配置检查，并按 Standards 与 Spec 两个维度做独立审查；有新提交时必须重新检查和审查。

适合单次上下文的小改动可走仓库原生 GitHub 轻量流程：一个 Issue、独立分支、与风险相称的测试、独立审查和 PR。Handrail 的完整链路命令要求已批准的 Spec 与工单，不要只为凑流程而创建它们。涉及多个行为、迁移、安全或生产配置的改动使用完整流程。

证据文件放在 `.handrail/evidence/`，默认不提交到 Git。真正长期保留的记录是 PR 讨论、CI 结果和合并提交。

---

## 配置

配置文件是 `.handrail/config.json`，主要字段如下。

```json
{
  "version": 1,
  "project": {
    "name": "订单系统",
    "docsDir": "docs",
    "adrDir": "docs/adr",
    "glossary": "GLOSSARY.md"
  },
  "github": {
    "repo": null,
    "baseBranch": "main",
    "labels": {
      "requirement": "requirement",
      "spec": "spec",
      "task": "task",
      "specApproved": "spec-approved",
      "ticketsApproved": "tickets-approved"
    }
  },
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-5-5",
    "baseUrl": "https://api.anthropic.com",
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "maxTokens": 8192,
    "maxTurns": 40
  },
  "checks": {
    "commands": ["npm test", "npm run build"],
    "timeoutMs": 600000
  },
  "workflow": {
    "requireSpecApproval": true,
    "requireTicketsApproval": true,
    "requireReview": true,
    "requireChecks": true,
    "requireCleanCI": true,
    "branchPrefix": "feat/issue-",
    "maxTicketsPerSpec": 12
  }
}
```

`labels` 可以映射到团队已有的标签命名。关键是“适合代理执行”和“已由人批准”必须是两个不同的标签。

`agent.allowedCommands` 为空表示允许执行任意命令（仍会拦截 `deniedCommands` 里的危险模式）。如果设置了允许前缀列表，代理只能执行匹配的命令。这个机制是防误操作，不是安全沙箱。代理仍然在你的工作目录里运行，请只在你信任的仓库里使用。

---

## 仓库结构

```text
src/
├── cli.ts                 命令行入口
├── commands/              命令适配层
├── core/
│   ├── agent/             Anthropic 循环、外部命令、mock、工具
│   ├── workflow/          需求、澄清、规格、任务、实现、审查、PR、验收
│   ├── config.ts          配置结构与校验
│   ├── github.ts          gh 命令封装
│   ├── git.ts             git 命令封装
│   ├── evidence.ts        执行证据库
│   ├── gates.ts           人工门禁检查
│   ├── policy.ts          PR 策略检查逻辑
│   ├── scaffold.ts        仓库脚手架
│   └── state.ts           本地流程状态
├── prompts/               各阶段提示词模板
└── templates/             复制到目标仓库的文件模板
```

---

## 设计决策

- [0001 人工门禁靠标签和 CI，不靠提示词](docs/adr/0001-human-gates-are-labels-and-ci.md)
- [0002 证据来自真实执行](docs/adr/0002-evidence-comes-from-execution.md)
- [0003 GitHub 是正式记录系统](docs/adr/0003-github-is-the-system-of-record.md)
- [0004 代理运行时是可插拔的](docs/adr/0004-agent-runtime-is-pluggable.md)
- [0005 任务是垂直切片](docs/adr/0005-tickets-are-vertical-slices.md)
- [0006 Handrail 永不合并](docs/adr/0006-handrail-never-merges.md)

---

## Handrail 不做什么

- 不合并 Pull Request。
- 不削弱分支保护，不批准自己创建的 PR。
- 不替代 CI，而是要求 CI 存在并通过。
- 不把 API Key 写进仓库。密钥来自环境变量。
- 不把未执行的测试写成已通过。
- 不把 `ready-for-agent` 当作人工批准。

---

## 开发

```bash
npm install
npm run build
npm test
npm run typecheck
npm run test:coverage
```

测试覆盖配置校验、门禁、任务依赖图、证据、策略、脚手架、JSON 提取、提示词加载和代理工具的安全边界。

---

## 许可证

MIT
