# TypeScript

> TypeScript library for the Agent Client Protocol

The [@zed-industries/agent-client-protocol](https://www.npmjs.com/package/@zed-industries/agent-client-protocol) npm
package provides implementations of both sides of the Agent Client Protocol that
you can use to build your own agent server or client.

To get started, add the package as a dependency to your project:

```bash
npm install @zed-industries/agent-client-protocol
```

Depending on what kind of tool you're building, you'll need to use either the
[AgentSideConnection](https://zed-industries.github.io/agent-client-protocol/classes/AgentSideConnection.html)
class or the
[ClientSideConnection](https://zed-industries.github.io/agent-client-protocol/classes/ClientSideConnection.html)
class to establish communication with the ACP counterpart.

You can find example implementations of both sides in the [main repository](https://github.com/zed-industries/agent-client-protocol/tree/main/typescript/examples). These can be run from your terminal or from an ACP Client like [Zed](https://zed.dev), making them great starting points for your own integration!

Browse the [TypeScript library reference](https://zed-industries.github.io/agent-client-protocol) for detailed API documentation.

For a complete, production-ready implementation of an ACP agent, check out [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/zed-integration/zedIntegration.ts).
