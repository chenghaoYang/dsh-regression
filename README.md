# dsh-regression

[![CI](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml/badge.svg)](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

**Deterministic workspace regression testing for coding agents.**

Turn an explicit correction into an executable case. Run the same task in an isolated Git worktree, compare DSH profiles or runner settings, and report whether the final workspace violates a deterministic contract.

```text
Agent changes a forbidden public file
→ /regress capture
→ run baseline and candidate
→ regression detected
→ declared environment overlay minimized
```

`dsh-regression` is a local CLI with a DSH command entry: `/regress capture`, `/regress run`, `/regress report`, and `/regress cause`.

[简体中文](README.zh-CN.md)

## 60-second demo — no API key required

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

The bundled fake agent passes normally. The Cause demo enables one declared environment overlay that makes it modify `src/public/`, then confirms that removing the overlay restores a pass. These five examples are a **verifier smoke pack**: they exercise the local runner, worktree isolation, deterministic checks, reports, and Cause; they are not a model capability leaderboard.

## Install as a DeepSeek Harness plugin

`dsh-regression` targets DeepSeek Harness `0.1.0-rc.8`, which is still a developer preview.

```bash
dsh plugin --profile web add github:chenghaoYang/dsh-regression#v0.1.2
```

Git installs build the TypeScript source through `prepare`. With pnpm 10+, the first install may ask you to allow that build in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-regression: true
```

Re-run the add command, then restart the profile. Bundle membership is applied at profile startup.

Inside a DSH conversation, correct the agent explicitly and capture the last two human messages:

```text
/regress capture preserve-public-api \
  --allow-path 'src/internal/**' \
  --forbid-path 'src/public/**' \
  --check-command 'pnpm test api-compat'
```

The command writes `.dsh-regression/cases/preserve-public-api.yaml`. It never adds an LLM judge. Common deterministic rules may be inferred from the correction, but explicit verifier flags are the reliable source of the case contract.

Other DSH commands:

```text
/regress run .dsh-regression/cases/preserve-public-api.yaml --label baseline
/regress run .dsh-regression/cases/preserve-public-api.yaml --label candidate --profile my-new-profile
/regress report <baseline-run.json> <candidate-run.json>
/regress cause --case <case.yaml> --spec <cause.yaml> --trials 3
```

## Standalone CLI

```text
dsh-regression capture --id ID --prompt TEXT [verifier options]
dsh-regression run CASE [--label NAME] [--profile PROFILE] [--trials N]
dsh-regression report --run RUN.json [--run RUN.json] [--format markdown|json]
dsh-regression cause --case CASE --spec cause.yml [--trials N]
```

Capture verifier options are repeatable:

```bash
dsh-regression capture \
  --id no-public-api-break \
  --prompt 'Refactor the authentication cache.' \
  --correction 'Do not modify the public API.' \
  --allow-path 'src/internal/**' \
  --forbid-path 'src/public/**' \
  --check-command 'pnpm test api-compat'
```

## Case format

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

Paths in `fixture.repository` are relative to the case file. Check paths are repository-relative. Every trial resolves `git_ref` to a commit, creates a detached worktree, launches the runner there, runs every verifier, and stores results under `.dsh-regression/runs/`.

### Deterministic verifiers

- `command`: passes only when the configured command exits `0`.
- `diff-path`: enforces allow/forbid globs, maximum changed files, dependency-file stability, and test-deletion rules over tracked and non-ignored untracked paths.
- `json-schema`: validates a JSON artifact against the configured JSON Schema file.
- `api-snapshot`: compares command output with the configured text baseline.

The core never calls a second model to judge the first one.

## Observability limits

The v0.1 run result observes the final workspace: changed paths, verifier outcomes, command output, runner stdout/stderr, and a patch artifact. It does not expose a complete agent trajectory or tool-by-tool replay.

`diff-path` follows Git's standard untracked-file view. Files ignored by `.gitignore` are not observed by this verifier. If a path must be checked, make it visible to Git or use a command verifier that checks it directly.

## Compare runs

Run the same case against two profiles or runner settings, then create a Markdown or JSON report:

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

No token, cost, or latency number is invented when the runner does not expose it.

## Find the failure-inducing component set

Cause specs declare the components that can be toggled reproducibly. v0.1 uses declarative environment overlays, which a runner command can map to plugin or Profile patch variants:

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

`cause` first confirms that the empty baseline passes and the full candidate fails. It then applies delta debugging and reverse checks. Results deliberately use careful language:

- `confirmed`: baseline passes, candidate fails, the 1-minimal set fails, and removing each member restores a pass.
- `probable`: a reproducible set was found, but at least one reverse check was unstable.
- `inconclusive`: the endpoints or minimized set were not stable.

“1-minimal” means no single declared overlay can be removed while preserving the failure. It is not a claim of mathematical causality or globally minimum cardinality.

## Verifier smoke pack

The repository ships five local fake-agent cases:

- `no-public-api-break`
- `no-unasked-dependency`
- `no-test-deletion`
- `respect-path-boundary`
- `preserve-output-schema`

They require no network or API key and are intended to smoke-test verifier behavior. Replace the runner with `adapter: dsh` to apply the same contracts to a real Profile.

## Evidence and roadmap

### Current evidence

The smoke pack demonstrates that a known workspace violation can be detected by deterministic checks and that a declared environment overlay can be reduced to a 1-minimal reproducing set. It is evidence for the verifier and reporting path, not a claim about general coding ability.

### Public evaluation route

The first public real evaluation target is [OmniCode's Review Response track](https://github.com/seal-research/OmniCode), whose official dataset and runnable environments cover repository-grounded review-response work across Python, Java, and C++ ([official dataset](https://huggingface.co/datasets/seal-research/OmniCode)). The evaluation should compare the same task under paired DSH configurations and report task success separately from contract violations.

Later evaluation targets are [OctoBench](https://arxiv.org/abs/2601.10343) for scaffold-aware instruction following and [Terminal-Bench](https://www.harborframework.com/docs/tutorials/running-terminal-bench) for terminal and environment behavior. These are evaluation references and pinned external task sets, not part of the local smoke pack.

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

The action builds this package from the pinned tag and runs the case in the caller checkout. The case's runner determines whether the job needs a DSH Profile or only a local command runner.

## Current v0.1.2 scope

v0.1.2 provides explicit capture, live command/DSH runners, detached worktree isolation, deterministic verifiers, comparable-run validation, cooperative cancellation, Markdown/JSON reports, declaration-based Cause minimization, a DSH command entry, a DSH bundle, and GitHub Action execution.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Released under the [MIT License](LICENSE).
