# Post‑Fix Review (Docs, Examples, Implementation)

This follow‑up review validates the recent fixes against the ACP docs in `docs/` and examples in `examples/`.

## What’s Fixed
- Protocol endpoints: Updated to ACP namespaced methods.
  - Handlers now accept: `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`.
  - Outgoing calls use: `session/update`, `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`.
- Session-aware FS and CWD:
  - `Session` now builds `FileResolver` with the session-bound `ACPFileSystem`.
  - `ACPFileSystem` accepts `sessionCwd` and normalizes via `PathUtils.normalizePath(file, sessionCwd)`.
- No more echoing user content:
  - Removed `user_message_chunk` emission from the agent; output uses `agent_message_chunk` and tool updates.
- MCP servers carried through:
  - `Config` includes optional `mcpServers`; `newSession` stores `params.mcpServers`.
- License alignment:
  - README updated to MIT; matches `package.json`.

## Remaining Gaps / Suggestions
- Permission response handling:
  - In `PermissionManager.processResponse`, the check `if (outcome === 'allowed')` doesn’t match the schema (response is `'selected'` or `'cancelled'`).
  - Suggestion: Treat `'selected'` as the only positive branch and infer allow/deny strictly from `optionId`; treat `'cancelled'` as deny‑once.
- Client capabilities usage:
  - `initialize` stores `clientCapabilities` and FS methods now respect them (gated in `readTextFile`/`writeTextFile`). Optional enhancement: instead of erroring when unsupported, skip ACP calls and go directly to fallback where appropriate.
- MCP servers behavior:
  - You now accept/store `mcpServers`, but they’re not used to wire MCP backends. Optional enhancement for parity with examples: plumb into session setup or document as “accepted but not used”.
- API.md drift:
  - Still shows non‑spec shapes (e.g., `PermissionOption { id,label }`, custom `PermissionOutcome`). Recommend updating to match `docs` schemas and actual code (`optionId`, `kind`, `RequestPermissionResponse.outcome: selected|cancelled`).
- Tests (nice to have):
  - Add a unit covering endpoint names (ensures `session/*` and `fs/*` are used).
  - Add a unit covering permission response mapping from `optionId` to decision (allow/deny + scope).

## Verdict
- Protocol compliance: Looks correct now for method names and notifications.
- Session FS behavior: Correctly session‑scoped (`sessionId` + `cwd`).
- Messaging: No improper `user_message_chunk` emissions observed.
- Docs: README/license aligned; API.md still needs updates for types.

If you want, I can patch `PermissionManager.processResponse` and refresh `API.md` to match the spec and implementation.
