# Contributing

Issues and pull requests are welcome. Keep changes focused on executable behavior regression tests rather than a general benchmark framework.

## Development

```bash
npm install
npm run check
```

Add a test that exercises the observable failure your change addresses. New verifiers should be deterministic, produce a clear failure message, and work inside an isolated Git worktree.

DeepSeek Harness is still in developer preview. When an upstream API changes, link the corresponding official source or documentation in the pull request.
