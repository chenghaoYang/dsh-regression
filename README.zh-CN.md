# dsh-regression

[![CI](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml/badge.svg)](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

**让 Coding Agent 不再重复犯同一种错误。**

把一次明确纠错变成可执行的回归测试，在隔离 Git worktree 中重跑，对比 DSH Profile 与插件，并找出能稳定复现失败的 1-minimal Harness 变更集合。

```text
Agent 修改了禁止修改的 public 文件
→ /regress capture
→ 更新 Profile 或 Plugin
→ 检测到行为回归
→ 找到最小失败诱发组件集合
```

> pytest for agent behavior. git bisect for harness configuration.

[English](README.md)

## 60 秒离线演示——不需要 API Key

```bash
git clone https://github.com/chenghaoYang/dsh-regression.git
cd dsh-regression
npm install

npx dsh-regression run examples/cases/no-public-api-break.yaml --label baseline
npx dsh-regression cause \
  --case examples/cases/no-public-api-break.yaml \
  --spec examples/cause.yaml \
  --trials 1
```

内置 fake agent 默认通过；Cause 演示会启用一个使它修改 `src/public/` 的组件。`dsh-regression` 会复现失败，并确认移除该组件后恢复通过。

## 作为 DeepSeek Harness 插件安装

当前兼容基线是仍处于 Developer Preview 的 DeepSeek Harness `0.1.0-rc.8`：

```bash
dsh plugin --profile web add github:chenghaoYang/dsh-regression#v0.1.0
```

Git 安装会通过 `prepare` 构建 TypeScript。pnpm 10+ 第一次可能要求在 Profile 的 `pnpm-workspace.yaml` 中明确允许构建：

```yaml
allowBuilds:
  dsh-regression: true
```

重新执行安装命令，然后重启 Profile；Bundle 成员变化只会在 Profile 启动时生效。

在 DSH 会话中明确纠正 Agent 后，捕获最近两条人类消息：

```text
/regress capture preserve-public-api \
  --forbid-path 'src/public/**' \
  --check-command 'pnpm test api-compat'
```

命令会写入 `.dsh-regression/cases/preserve-public-api.yaml`。核心不使用 LLM Judge。对于“不修改 public API”“不新增依赖”“不删除测试”等常见、可确定验证的纠错，会预填对应 verifier；无法可靠推断时会要求显式提供 verifier。

其他 DSH 命令：

```text
/regress run .dsh-regression/cases/preserve-public-api.yaml --label baseline
/regress run .dsh-regression/cases/preserve-public-api.yaml --label candidate --profile my-new-profile
/regress report <baseline-run.json> <candidate-run.json>
/regress cause --case <case.yaml> --spec <cause.yaml> --trials 3
```

## 独立 CLI

```text
dsh-regression capture --id ID --prompt TEXT [verifier 参数]
dsh-regression run CASE [--label NAME] [--profile PROFILE] [--trials N]
dsh-regression report --run RUN.json [--run RUN.json] [--format markdown|json]
dsh-regression cause --case CASE --spec cause.yml [--trials N]
```

捕获示例：

```bash
dsh-regression capture \
  --id no-public-api-break \
  --prompt '重构认证缓存。' \
  --correction '不要修改 public API。' \
  --forbid-path 'src/public/**' \
  --check-command 'pnpm test api-compat'
```

## Case 格式

```yaml
version: 1
id: no-public-api-break
fixture:
  repository: ../..
  git_ref: HEAD
  cwd: examples/fixtures/basic
runner:
  adapter: dsh
  profile: headless
  timeout_seconds: 900
task:
  prompt: 重构认证缓存，但不要修改 public API。
run:
  trials: 3
  pass_policy: all
checks:
  - id: api-tests
    type: command
    run: pnpm test api-compat
  - id: public-files-untouched
    type: diff-path
    forbid: [src/public/**]
  - id: result-contract
    type: json-schema
    file: artifacts/result.json
    schema: schema/result.schema.json
```

`fixture.repository` 相对 Case 文件解析；Check 路径均为仓库相对路径。每个 Trial 都先把 `git_ref` 解析为 commit，再创建独立 worktree、启动 runner、运行所有 verifier，并把日志与 patch 保存到 `.dsh-regression/runs/`。

### 确定性 Verifier

- `command`：命令退出码为 `0` 才通过。
- `diff-path`：覆盖 tracked/untracked 文件，支持允许/禁止路径、最大修改文件数、依赖文件不变和禁止删除测试。
- `json-schema`：用仓库中的 JSON Schema 验证 JSON 产物。
- `api-snapshot`：执行命令，把文本 API surface 与已提交 baseline 直接比较。

核心不会为了评测一个模型再调用另一个模型。

## 对比运行

```bash
dsh-regression run case.yaml --label baseline --profile standard --trials 3
dsh-regression run case.yaml --label candidate --profile experimental --trials 3
dsh-regression report --run baseline/run.json --run candidate/run.json --out report.md
```

```text
Case: no-public-api-break
Baseline: 3/3 passed
Candidate: 0/3 passed
Status: REGRESSION
```

Runner 没有提供 token、cost 或 latency 时，报告不会编造数值。

## 定位失败诱发组件

Cause Spec 只声明能被稳定切换的组件。v0.1 使用环境变量 overlay，可由 runner 命令映射到 Plugin/Profile patch：

```yaml
version: 1
components:
  - id: plugin:tool-bootstrap
    kind: plugin
    env:
      DSH_PATCH_TOOL_BOOTSTRAP: enabled
  - id: profile:max-tools-26
    kind: profile
    env:
      DSH_MAX_TOOLS: "26"
```

`cause` 先确认空 Baseline 稳定通过、完整 Candidate 稳定失败，再运行 Delta Debugging 和反向检查：

- `confirmed`：Baseline 通过、Candidate 失败、1-minimal 集合失败，并且移除任一成员后恢复通过。
- `probable`：找到了可复现集合，但至少一个反向检查不稳定。
- `inconclusive`：端点或最小化结果不稳定。

“1-minimal”只表示无法再单独移除一个成员，不宣称数学因果或全局最小基数。

## 可直接运行的 Case Pack

仓库内置五个确定性 Case：

- `no-public-api-break`
- `no-unasked-dependency`
- `no-test-deletion`
- `respect-path-boundary`
- `preserve-output-schema`

它们使用本地 fake agent，贡献者无需网络或 API Key 即可复现。把 runner 改成 `adapter: dsh` 即可把同样的契约应用于真实 Profile。

## GitHub Action

```yaml
- uses: chenghaoYang/dsh-regression@v0.1.0
  with:
    case: .dsh-regression/cases/no-public-api-break.yaml
    label: candidate
    profile: headless
    trials: 3
```

Action 会从固定 tag 构建本项目，并在调用方仓库中运行 Case。

## v0.1.0 范围

已经包含：显式 capture、Live command/DSH runner、隔离 worktree、确定性 verifier、Markdown/JSON 报告、受限组件最小化、DSH Bundle、独立 CLI 和 CI 集成。

明确不包含：自动识别纠错、LLM Judge、Guard Mode、Frozen-tool/Frozen-model Replay、任意 Prompt/Tool Schema 消融、云服务、Dashboard 和自动 Skill/Memory 演化。DSH 当前没有把这些作为现成服务暴露，本项目也不会假装已经实现。

## 开发

```bash
npm install
npm run check
npm pack --dry-run
```

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，项目采用 [MIT License](LICENSE)。
