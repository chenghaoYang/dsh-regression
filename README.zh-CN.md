# dsh-regression

[![CI](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml/badge.svg)](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

**面向 Coding Agent 的确定性工作区回归测试。**

把一次明确纠错变成可执行 Case，在隔离的 Git worktree 中重跑同一任务，对比 DSH Profile 或 runner 设置，并报告最终工作区是否违反确定性契约。

```text
Agent 修改了禁止修改的 public 文件
→ /regress capture
→ 运行 baseline 和 candidate
→ 检测到回归
→ 缩小声明式环境 overlay
```

`dsh-regression` 是一个本地 CLI，并提供 DSH 命令入口：`/regress capture`、`/regress run`、`/regress report` 和 `/regress cause`。

[English](README.md)

## 60 秒演示——不需要 API Key

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

内置 fake agent 默认通过；Cause 演示启用一个声明式环境 overlay，使它修改 `src/public/`，然后确认移除该 overlay 后恢复通过。这五个示例是 **verifier smoke pack**：用于冒烟验证本地 runner、worktree 隔离、确定性检查、报告和 Cause，不是模型能力排行榜。

## 作为 DeepSeek Harness 插件安装

`dsh-regression` 的目标基线是仍处于 Developer Preview 的 DeepSeek Harness `0.1.0-rc.8`。

```bash
dsh plugin --profile web add github:chenghaoYang/dsh-regression#v0.1.2
```

Git 安装会通过 `prepare` 构建 TypeScript。pnpm 10+ 第一次可能要求在 Profile 的 `pnpm-workspace.yaml` 中允许构建：

```yaml
allowBuilds:
  dsh-regression: true
```

重新执行安装命令，然后重启 Profile。Bundle 成员只会在 Profile 启动时生效。

在 DSH 会话中明确纠正 Agent，并捕获最近两条人类消息：

```text
/regress capture preserve-public-api \
  --allow-path 'src/internal/**' \
  --forbid-path 'src/public/**' \
  --check-command 'pnpm test api-compat'
```

命令会写入 `.dsh-regression/cases/preserve-public-api.yaml`。核心不会加入 LLM Judge。常见确定性规则可能从纠错中推断，但显式 verifier 参数才是 Case 契约的可靠来源。

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

Capture verifier 参数可重复传入：

```bash
dsh-regression capture \
  --id no-public-api-break \
  --prompt '重构认证缓存。' \
  --correction '不要修改 public API。' \
  --allow-path 'src/internal/**' \
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
  prompt: Refactor the authentication cache without changing public APIs.
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

`fixture.repository` 相对 Case 文件解析；Check 路径均为仓库相对路径。每个 Trial 都先把 `git_ref` 解析为 commit，再创建 detached worktree、启动 runner、运行所有 verifier，并把结果保存到 `.dsh-regression/runs/`。

### 确定性 Verifier

- `command`：配置命令退出码为 `0` 才通过。
- `diff-path`：对 tracked 和未被 Git 忽略的 untracked 路径执行允许/禁止 glob、最大修改文件数、依赖文件稳定和禁止删除测试等检查。
- `json-schema`：使用配置的 JSON Schema 文件验证 JSON 产物。
- `api-snapshot`：把命令输出与配置的文本 baseline 比较。

核心不会为了评测一个模型再调用另一个模型。

## 可观测性边界

v0.1 的 run 结果观察最终工作区：变更路径、verifier 结果、命令输出、runner stdout/stderr 和 patch 产物。它不会提供完整 Agent 轨迹或逐工具回放。

`diff-path` 遵循 Git 对 untracked 文件的标准视图。被 `.gitignore` 忽略的文件不会被该 verifier 观察；如果某个路径必须被检查，应让它对 Git 可见，或直接使用 command verifier 检查。

## 对比运行

对同一个 Case 使用两个 Profile 或 runner 设置运行，然后生成 Markdown 或 JSON 报告：

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

Cause Spec 只声明能被稳定切换的组件。v0.1 使用声明式环境 overlay，由 runner 命令把它映射到 Plugin 或 Profile patch 变体：

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

`cause` 会先确认空 Baseline 通过、完整 Candidate 失败，再执行 Delta Debugging 和反向检查。结果使用谨慎措辞：

- `confirmed`：Baseline 通过、Candidate 失败、1-minimal 集合失败，并且移除每个成员后都恢复通过。
- `probable`：找到了可复现集合，但至少一个反向检查不稳定。
- `inconclusive`：端点或最小化结果不稳定。

“1-minimal”只表示移除任一声明式 overlay 后便无法保持失败，不宣称数学因果或全局最小基数。

## Verifier smoke pack

仓库内置五个本地 fake-agent Case：

- `no-public-api-break`
- `no-unasked-dependency`
- `no-test-deletion`
- `respect-path-boundary`
- `preserve-output-schema`

它们不需要网络或 API Key，用于冒烟验证 verifier 行为。把 runner 改成 `adapter: dsh`，即可把同样的契约应用到真实 Profile。

## 效果证据与公开评测路线

### 当前效果证据

Smoke pack 展示了：确定性检查可以检测已知工作区违规，声明式环境 overlay 可以被缩小为 1-minimal 复现集合。这是 verifier 和报告链路的证据，不是通用编码能力结论。

### 公开评测路线

首个公开真实评测目标是 [OmniCode 的 Review Response track](https://github.com/seal-research/OmniCode)。它的官方数据集和可运行环境覆盖 Python、Java、C++ 的仓库级 code-review response 任务（[官方数据集](https://huggingface.co/datasets/seal-research/OmniCode)）。评测应在配对的 DSH 配置下运行同一任务，并把任务成功与契约违规分开报告。

后续评测目标是用于 scaffold-aware instruction following 的 [OctoBench](https://arxiv.org/abs/2601.10343)，以及用于终端和环境行为的 [Terminal-Bench](https://www.harborframework.com/docs/tutorials/running-terminal-bench)。它们是评测参考和需要固定版本的外部任务集，不属于本地 smoke pack。

## GitHub Action

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: chenghaoYang/dsh-regression@v0.1.2
    with:
      case: .dsh-regression/cases/no-public-api-break.yaml
      label: candidate
      profile: headless
      trials: 3
```

Action 会从固定 tag 构建本项目，并在调用方 checkout 中运行 Case。是否需要 DSH Profile 或只需要本地 command runner，由 Case 的 runner 决定。

## 当前 v0.1.2 范围

v0.1.2 提供显式 capture、Live command/DSH runner、detached worktree 隔离、确定性 verifier、可比运行校验、协作式取消、Markdown/JSON 报告、声明式 Cause 最小化、DSH 命令入口、DSH Bundle 和 GitHub Action 执行。

## 开发

```bash
npm install
npm run check
npm pack --dry-run
```

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，项目采用 [MIT License](LICENSE)。
