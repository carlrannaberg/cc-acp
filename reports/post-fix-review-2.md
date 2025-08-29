# Post‑Fix Review (Round 2)

A second pass after the latest changes. Overall protocol and session behavior still look solid. Three items remain to be addressed for full alignment with the docs and examples.

## Outstanding Issues

- Permission outcome mapping (src/bridge/permissions.ts)
  - Current: `processResponse` checks `if (outcome === 'allowed')`.
  - Spec/Examples: `RequestPermissionResponse.outcome` is `'selected' | 'cancelled'`; allow/deny must be derived from the `optionId` selected (e.g., `allow_once`, `deny_once`, etc.).
  - Impact: Inconsistent handling if clients never return `'allowed'` as an outcome. Could incorrectly default to deny.
  - Suggestion: Remove the `outcome === 'allowed'` branch. Treat `'cancelled'` as a deny‑once. Otherwise, trust `optionId` mapping for allow/deny + scope.

- API.md drift (API.md)
  - Permission types still show non‑spec shapes:
    - `PermissionOption { id, label }` vs `optionId: string; name: string; kind: PermissionOptionKind` per docs and code.
    - Custom `PermissionOutcome = 'approved' | 'denied' | 'cancelled'` vs spec’s `selected | cancelled`.
  - Impact: Confusing for integrators; mismatched with code and docs.
  - Suggestion: Update API.md to match `docs/agent-client-protocol/schema.md` and current implementation.

- Process listeners registered per instance (src/bridge/agent.ts)
  - `setupErrorHandlers` adds `process.on('uncaughtException'| 'unhandledRejection')` every time an agent is constructed. Tests show `MaxListenersExceededWarning`.
  - Impact: Potential memory leak warnings and duplicated logging in long‑lived or test environments.
  - Suggestion: Guard with a module‑level flag so handlers register once, or use `process.once`, or centralize logging. Optionally raise the limit with `process.setMaxListeners`, but preferably prevent multiple registrations.

## Verified OK

- Protocol endpoints and notifications match ACP spec (`session/*`, `fs/*`).
- Session‑scoped filesystem and CWD normalization are correctly wired.
- No `user_message_chunk` emitted by the agent.
- `clientCapabilities` are stored and respected in fs methods.
- Tests pass locally; only warnings come from process listeners.

## Next Actions

- Patch `processResponse` to rely on `optionId` + treat `'cancelled'` as deny‑once.
- Update API.md to reflect spec‑compliant permission types and outcomes.
- Add a guard in `setupErrorHandlers` to avoid multiple process listeners.

If you want, I can apply these patches directly.

