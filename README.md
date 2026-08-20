# dsh-regression

[![CI](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml/badge.svg)](https://github.com/chenghaoYang/dsh-regression/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

**Your coding agent should never make the same mistake twice.**

Turn an explicit correction into an executable regression test. Run it in isolated Git worktrees. Compare DSH profiles and plugins, then find a 1-minimal harness change that reproduces the failure.

```text
Agent changed a forbidden public file
→ /regress capture
→ profile or plugin upgrade
→ regression detected
→ smallest failure-inducing component set identified
```

> pytest for agent behavior. git bisect for harness configuration.

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

The bundled fake agent passes normally. The cause demo enables one component that makes it modify `src/public/`; `dsh-regression` reproduces the failure and confirms that removing that component restores a pass.

## Install as a DeepSeek Harness plugin

`dsh-regression` targets DeepSeek Harness `0.1.0-rc.8`, which is still a developer preview.

```bash
dsh plugin --profile web add github:chenghaoYang/dsh-regression#v0.1.0
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
  --forbid-path 'src/public/**' \
  --check-command 'pnpm test api-compat'
```

The command writes `.dsh-regression/cases/preserve-public-api.yaml`. It never adds an LLM judge. If the correction states a common deterministic rule such as “do not modify public API,” “do not add dependencies,” or “do not delete tests,” the command pre-fills the corresponding verifier; otherwise it asks for an explicit verifier option.

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

Paths in `fixture.repository` are relative to the case file. Check paths are repository-relative. Every trial resolves `git_ref` to a commit, creates a detached worktree, launches the runner there, runs every verifier, and stores logs plus a patch under `.dsh-regression/runs/`.

### Deterministic verifiers

- `command`: passes only when the configured command exits `0`.
- `diff-path`: enforces allow/forbid globs, maximum changed files, dependency-file stability, and test-deletion rules across tracked and untracked files.
- `json-schema`: validates a JSON artifact against a repository-owned JSON Schema.
- `api-snapshot`: runs a command and compares its textual API surface with a committed baseline.

The core never calls a second model to judge the first one.

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

Cause specs declare only components that can be toggled reproducibly. v0.1 uses environment overlays, which can select plugin/profile patch variants in a runner command:

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

“1-minimal” means no single member can be removed while preserving the failure; it is not a claim of mathematical causality or globally minimum cardinality.

## Ready-to-run case pack

The repository ships five deterministic cases:

- `no-public-api-break`
- `no-unasked-dependency`
- `no-test-deletion`
- `respect-path-boundary`
- `preserve-output-schema`

They use a local fake agent so contributors can test without network access or an API key. Replace the runner with `adapter: dsh` to apply the same contracts to a real profile.

## GitHub Action

```yaml
- uses: chenghaoYang/dsh-regression@v0.1.0
  with:
    case: .dsh-regression/cases/no-public-api-break.yaml
    label: candidate
    profile: headless
    trials: 3
```

The action builds this package from the pinned tag and runs the case in the caller checkout.

## Scope of v0.1.0

Included: explicit capture, live command/DSH runners, isolated worktrees, deterministic verifiers, Markdown/JSON reports, restricted component minimization, a DSH bundle, a CLI, and CI integration.

Not included: automatic correction detection, an LLM judge, Guard Mode, frozen-tool/model replay, arbitrary prompt or tool-schema minimization, cloud storage, a dashboard, or automatic Skill/Memory evolution. DSH does not expose those as finished services today, and this release does not pretend otherwise.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Released under the [MIT License](LICENSE).
