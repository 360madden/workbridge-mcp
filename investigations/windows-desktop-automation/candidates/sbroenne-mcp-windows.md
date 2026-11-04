# sbroenne/mcp-windows — leading new provider

Repo: https://github.com/sbroenne/mcp-windows
Technology: .NET 10, MCP plus `wincli` CLI, persistent CLI daemon.

Strengths to test:
- Observed element IDs tied to process lifetime and window identity; stale IDs must reject.
- Bounded `ui snapshot`, changes-only responses, direct text/table reads.
- Semantic action path, fallback physical input, window identity/focus validation and screenshots.
- Latency reduction from persistent CLI process and multiple steps per call.

Risks/open questions:
- Compare independently; author benchmarks were not against installed WinApp.
- Verify whether desktop arbitration covers separate MCP processes and Workbridge callers; keep Workbridge's central lock either way.
- Confirm exact release, standalone build and runtime packaging on host before installation.
- Distinguish input dispatch from independently confirmed application outcome.

Status: research candidate only, not installed for this investigation.
