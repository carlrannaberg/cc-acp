# Docs & Examples Implementation Review

This report compares our implementation (`src/`) to the ACP spec in `docs/` and the sample integrations in `examples/`. It highlights mismatches, risks, and suggested fixes.

## Summary
- Protocol method names diverge from ACP spec (namespacing and endpoints).
- Session-aware filesystem use is inconsistent; potential wrong session IDs and CWD base.
- Agent sends `user_message_chunk` back to the client, which is likely incorrect per prompt-turn flow.
- API.md drifts from code and spec (types, method names, semantics).
- Some capabilities and parameters (e.g., `mcpServers`, client FS capabilities) are parsed but unused.
- Minor packaging/docs inconsistencies (license label mismatch).

## Protocol Alignment
- RPC method naming does not match ACP docs or examples:
  - Implemented vs Spec:
    - `newSession` → should be `session/new` (request)
    - `loadSession` → should be `session/load` (request)
    - `prompt` → should be `session/prompt` (request)
    - `cancel` → should be `session/cancel` (notification)
    - `sessionUpdate` → should be `session/update` (notification)
    - `requestPermission` → should be `session/request_permission` (request)
    - `readTextFile` → should be `fs/read_text_file` (request)
    - `writeTextFile` → should be `fs/write_text_file` (request)
- Impact: Incompatibility with Zed and compliant ACP clients. The examples (`examples/gemini/acp.ts`) and spec (`docs/agent-client-protocol/*.md`) expect namespaced endpoints.
- Recommendation: Align `src/bridge/agent.ts` method dispatch and `Connection` send calls to the spec names, or add a compatibility shim mapping our internal names to the ACP endpoint names.

## Schemas & Types
- `NewSessionRequest` schema requires `mcpServers` (docs), but `ClaudeACPAgent.newSession` ignores it. Either support it (as in `examples/gemini/zed-integration.ts`) or make it optional if intentionally unimplemented.
- `PermissionOption` type mismatch between `API.md` and code/spec:
  - Code/spec: `{ optionId: string; name: string; kind: 'allow_once'|'allow_always'|'reject_once'|'reject_always' }`.
  - API.md shows `{ id, label, description? }` which does not match the spec or code.
- `PromptResponse.stopReason` union matches the spec (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`) — OK.
- `InitializeRequest` includes optional `clientCapabilities` (spec). We validate but do not use it to adjust behavior.

## Session & Filesystem Handling
- `ACPFileSystem` path normalization uses `process.cwd()` (default) instead of session CWD. Spec requires absolute paths; for relative inputs, the base should be the session’s `cwd`.
  - Risk: Relative paths resolve against the process CWD rather than the session root.
  - Fix: Provide session CWD to `ACPFileSystem` (via constructor) and use it in `PathUtils.normalizePath` calls.
- `Session` wires `FileResolver` with `options.fileSystemService` instead of the session’s `this.fileSystem`:
  - In `Session` constructor: `this.fileSystem = new ACPFileSystem(this.acpClient, this.id, options.fileSystemService)` (good), but `this.fileResolver = new FileResolver(this.config, options.fileSystemService)` (problematic).
  - Risk: `FileResolver.safeReadFile` will use a `FileSystemService` backed by an ACPFileSystem created with sessionId `''` (from `ClaudeACPAgent`), causing unsaved buffer reads with the wrong session ID.
  - Fix: Pass `this.fileSystem` to `FileResolver` so all ACP reads use the correct `sessionId` and CWD.

## Messaging Behavior
- On `prompt`, the agent sends a `sessionUpdate` with `user_message_chunk` echoing the user message text.
  - Spec intent: Client sends user content via `session/prompt`; the agent reports its output via `session/update` (e.g., `agent_message_chunk`, `tool_call`, `plan`).
  - Risk: Duplicates the user message in the UI and deviates from examples.
  - Fix: Remove the `user_message_chunk` emission; stream `agent_message_chunk` and tool/plan updates instead.

## Connection Implementation
- `Connection` is custom; examples in `examples/gemini/acp.ts` use the official `@zed-industries/agent-client-protocol` implementation with constants for method names. Our custom implementation increases drift risk.
- Streams are correctly wired (even if variable names are counterintuitive): we write to `WritableStream` and read from `ReadableStream`. No functional issue noted.

## Capabilities & Unused Params
- `clientCapabilities.fs.*` from `initialize` are parsed but not used to conditionally enable `fs/*` calls. Our `ACPFileSystem` tries ACP first then falls back; capability-awareness could be cleaner and explicit.
- `mcpServers` provided to `session/new` and `session/load` (per spec) are not used. Consider supporting them or document omission.

## Docs & Packaging
- License mismatch:
  - README: “ISC License - see package.json for details.”
  - package.json: `"license": "MIT"`
  - Fix: Align README and package.json.
- API.md drift:
  - Method names and several interfaces differ from the implementation and spec (e.g., `PermissionOption`, session manager methods, start semantics).
  - Fix: Update API.md to match actual code or adjust code to match the documented API.

## Suggested Fixes (Prioritized)
1. Protocol endpoints: Rename handler cases and client calls to ACP endpoints (`session/*`, `fs/*`). Consider a backward-compat mapping layer if needed.
2. FileResolver wiring: Pass `this.fileSystem` to `FileResolver` (use session-bound ACPFileSystem) and include session CWD in `ACPFileSystem` normalization.
3. Stop echoing user input: Remove `user_message_chunk` from agent output; only send `agent_message_chunk`, `tool_call`, `tool_call_update`, `plan`.
4. Use capabilities: Store `clientCapabilities` from `initialize` and guard `fs/*` calls; optionally enrich `ACPFileSystem.checkCapabilities()` integration.
5. Support/handle `mcpServers`: Accept and either no-op with docs note, or implement minimal wiring consistent with examples.
6. Docs consistency: Fix `API.md` (PermissionOption shape, method names, SessionManager API, `start()` semantics). Align license string in README/package.json.
7. Optional: Replace custom `Connection` with `@zed-industries/agent-client-protocol` to reduce future drift and ensure spec fidelity.

## Notable References
- Spec docs in `docs/agent-client-protocol/*` (method names, schemas, prompt-turn flow, file system, permissions).
- Examples in `examples/gemini/*` demonstrate proper endpoint naming and capability handling.
- Our implementation in `src/bridge/agent.ts`, `src/protocol/schemas.ts`, `src/bridge/session.ts`, `src/files/*`, and `src/utils/*` for the above observations.

