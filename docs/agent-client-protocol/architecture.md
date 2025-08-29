# Architecture

> Overview of the Agent Client Protocol architecture

The Agent Client Protocol defines a standard interface for communication between AI agents and client applications. The architecture is designed to be flexible, extensible, and platform-agnostic.

## Design Philosophy

The protocol architecture follows several key principles:

1. **MCP-friendly**: The protocol is built on JSON-RPC, and re-uses MCP types where possible so that integrators don't need to build yet-another representation for common data types.
2. **UX-first**: It is designed to solve the UX challenges of interacting with AI agents; ensuring there's enough flexibility to render clearly the agents intent, but is no more abstract than it needs to be.
3. **Trusted**: ACP works when you're using a code editor to talk to a model you trust. You still have controls over the agent's tool calls, but the code editor gives the agent access to local files and MCP servers.

## Setup

When the user tries to connect to an agent, the editor boots the agent sub-process on demand, and all communication happens over stdin/stdout.

Each connection can suppport several concurrent sessions, so you can have multiple trains of thought going on at once.

<img src="https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/server-client.svg?maxW=579&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=7f9a05a2a2bed471aa07f33578d67489" alt="Server Client setup" width="579" height="455" data-path="images/server-client.svg" srcset="https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/server-client.svg?w=280&maxW=579&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=a752f60209ea5034df78d3de964c837c 280w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/server-client.svg?w=560&maxW=579&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=b68483e3a9457e08ffae4d150a878948 560w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/server-client.svg?w=840&maxW=579&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=d6e1e384ed4a8aa074734c97e4dfd58b 840w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/server-client.svg?w=1100&maxW=579&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=d11306c6387bcc21c54bbd80bcc0a0d3 1100w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/server-client.svg?w=1650&maxW=579&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=0053ca0582ed364220d1944ddc98cd83 1650w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/server-client.svg?w=2500&maxW=579&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=6d6b06ab0da6c4995b6cb2365a7fa9ab 2500w" data-optimize="true" data-opv="2" />

ACP makes heavy use of JSON-RPC notifications to allow the agent to stream updates to the UI in real-time. It also uses JSON-RPC's bidrectional requests to allow the agent to make requests of the code editor: for example to request permissions for a tool call.

## MCP

Commonly the code editor will have user-configured MCP servers. When forwarding the prompt from the user, it passes configuration for these to the agent. This allows the agent to connect directly to the MCP server.

<img src="https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp.svg?maxW=689&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=cbf1d9e091a396778cf182cff266740a" alt="MCP Server connection" width="689" height="440" data-path="images/mcp.svg" srcset="https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp.svg?w=280&maxW=689&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=5350a26f808b9cc8228ab9fa6ec3c1a2 280w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp.svg?w=560&maxW=689&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=1b3178672cccb7c631d9086ebe557164 560w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp.svg?w=840&maxW=689&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=7ceefe307d195d38e16c876cc83e7852 840w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp.svg?w=1100&maxW=689&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=c76908e96c50580310a5e88cfc2c22ec 1100w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp.svg?w=1650&maxW=689&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=b0f364ee1e7acac182bb0d6f3fa76204 1650w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp.svg?w=2500&maxW=689&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=207a6cddbd5ea99dd31df99e32883a34 2500w" data-optimize="true" data-opv="2" />

The code editor may itself also wish to export MCP based tools. Instead of trying to run MCP and ACP on the same socket, the code editor can provide its own MCP server as configuration. As agents may only support MCP over stdio, the code editor can provide a small proxy that tunnels requests back to itself:

<img src="https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp-proxy.svg?maxW=632&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=a4152179775928d8088ea2445cee7578" alt="MCP connection to self" width="632" height="440" data-path="images/mcp-proxy.svg" srcset="https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp-proxy.svg?w=280&maxW=632&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=10267a225a37b4a9f17d5e0508b8d17c 280w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp-proxy.svg?w=560&maxW=632&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=3c5a54f261c289dcf3fed7e900d2619e 560w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp-proxy.svg?w=840&maxW=632&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=b2699e0e844830098fc8d22069cd1ea7 840w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp-proxy.svg?w=1100&maxW=632&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=03558833aa8ddb18108a7be899c79b1d 1100w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp-proxy.svg?w=1650&maxW=632&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=4f07702d50e371a98aea25c167347f27 1650w, https://mintcdn.com/zed-685ed6d6/FgcZrIi8cEeJJGHC/images/mcp-proxy.svg?w=2500&maxW=632&auto=format&n=FgcZrIi8cEeJJGHC&q=85&s=28ede327bc6b9f1122c559c4a1771172 2500w" data-optimize="true" data-opv="2" />
