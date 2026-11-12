---
version: "0.1.2"
level: auto
processes:
  design: copilot
  implementation: auto
  testing: auto
  documentation: auto
---

This format is based on [AI-DECLARATION.md](https://ai-declaration.md/en/0.1.2).

## Notes

- Written by Claude (Opus 5.5), an AI coding agent, in one autonomous session from a short brief: the format notes, the API shape and the test approach. The person who asked for it has not read the code.
- Every commit is authored by Claude.
- What checks exist: synthetic unit tests that build small caches byte by byte, and integration tests run against copies of two real Electron app caches (counts only).
- What doesn't: no human code review, no fuzzing, no security audit. Treat it as unaudited, especially on cache files from an untrusted source.
