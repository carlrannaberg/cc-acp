# Schema

> Schema definitions for the Agent Client Protocol

## Agent

Defines the interface that all ACP-compliant agents must implement.

Agents are programs that use generative AI to autonomously modify code. They handle
requests from clients and execute tasks using language models and tools.

### <span class="font-mono">authenticate</span>

Authenticates the client using the specified authentication method.

Called when the agent requires authentication before allowing session creation.
The client provides the authentication method ID that was advertised during initialization.

After successful authentication, the client can proceed to create sessions with
`new_session` without receiving an `auth_required` error.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

#### <span class="font-mono">AuthenticateRequest</span>

Request parameters for the authenticate method.

Specifies which authentication method to use.

**Type:** Object

**Properties:**

<ResponseField name="methodId" type={<a href="#authmethodid">AuthMethodId</a>} required>
  The ID of the authentication method to use. Must be one of the methods
  advertised in the initialize response.
</ResponseField>

### <span class="font-mono">initialize</span>

Establishes the connection with a client and negotiates protocol capabilities.

This method is called once at the beginning of the connection to:

* Negotiate the protocol version to use
* Exchange capability information between client and agent
* Determine available authentication methods

The agent should respond with its supported protocol version and capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

#### <span class="font-mono">InitializeRequest</span>

Request parameters for the initialize method.

Sent by the client to establish connection and negotiate capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

**Type:** Object

**Properties:**

<ResponseField name="clientCapabilities" type={<a href="#clientcapabilities">ClientCapabilities</a>}>
  Capabilities supported by the client.

  * Default: `{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}`
</ResponseField>

<ResponseField name="protocolVersion" type={<a href="#protocolversion">ProtocolVersion</a>} required>
  The latest protocol version supported by the client.
</ResponseField>

#### <span class="font-mono">InitializeResponse</span>

Response from the initialize method.

Contains the negotiated protocol version and agent capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

**Type:** Object

**Properties:**

<ResponseField name="agentCapabilities" type={<a href="#agentcapabilities">AgentCapabilities</a>}>
  Capabilities supported by the agent.

  * Default: `{"loadSession":false,"promptCapabilities":{"audio":false,"embeddedContext":false,"image":false}}`
</ResponseField>

<ResponseField name="authMethods" type={<><span><a href="#authmethod">AuthMethod</a></span><span>[]</span></>}>
  Authentication methods supported by the agent.

  * Default: `[]`
</ResponseField>

<ResponseField name="protocolVersion" type={<a href="#protocolversion">ProtocolVersion</a>} required>
  The protocol version the client specified if supported by the agent,
  or the latest protocol version supported by the agent.

  The client should disconnect, if it doesn't support this version.
</ResponseField>

<a id="session-cancel" />

### <span class="font-mono">session/cancel</span>

Cancels ongoing operations for a session.

This is a notification sent by the client to cancel an ongoing prompt turn.

Upon receiving this notification, the Agent SHOULD:

* Stop all language model requests as soon as possible
* Abort all tool call invocations in progress
* Send any pending `session/update` notifications
* Respond to the original `session/prompt` request with `StopReason::Cancelled`

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/prompt-turn#cancellation)

#### <span class="font-mono">CancelNotification</span>

Notification to cancel ongoing operations for a session.

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/prompt-turn#cancellation)

**Type:** Object

**Properties:**

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  The ID of the session to cancel operations for.
</ResponseField>

<a id="session-load" />

### <span class="font-mono">session/load</span>

Loads an existing session to resume a previous conversation.

This method is only available if the agent advertises the `loadSession` capability.

The agent should:

* Restore the session context and conversation history
* Connect to the specified MCP servers
* Stream the entire conversation history back to the client via notifications

See protocol docs: [Loading Sessions](https://agentclientprotocol.com/protocol/session-setup#loading-sessions)

#### <span class="font-mono">LoadSessionRequest</span>

Request parameters for loading an existing session.

Only available if the agent supports the `loadSession` capability.

See protocol docs: [Loading Sessions](https://agentclientprotocol.com/protocol/session-setup#loading-sessions)

**Type:** Object

**Properties:**

<ResponseField name="cwd" type={"string"} required>
  The working directory for this session.
</ResponseField>

<ResponseField
  name="mcpServers"
  type={
  <>
    <span>
      <a href="#mcpserver">McpServer</a>
    </span>
    <span>[]</span>
  </>
}
  required
>
  List of MCP servers to connect to for this session.
</ResponseField>

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  The ID of the session to load.
</ResponseField>

<a id="session-new" />

### <span class="font-mono">session/new</span>

Creates a new conversation session with the agent.

Sessions represent independent conversation contexts with their own history and state.

The agent should:

* Create a new session context
* Connect to any specified MCP servers
* Return a unique session ID for future requests

May return an `auth_required` error if the agent requires authentication.

See protocol docs: [Session Setup](https://agentclientprotocol.com/protocol/session-setup)

#### <span class="font-mono">NewSessionRequest</span>

Request parameters for creating a new session.

See protocol docs: [Creating a Session](https://agentclientprotocol.com/protocol/session-setup#creating-a-session)

**Type:** Object

**Properties:**

<ResponseField name="cwd" type={"string"} required>
  The working directory for this session. Must be an absolute path.
</ResponseField>

<ResponseField
  name="mcpServers"
  type={
  <>
    <span>
      <a href="#mcpserver">McpServer</a>
    </span>
    <span>[]</span>
  </>
}
  required
>
  List of MCP (Model Context Protocol) servers the agent should connect to.
</ResponseField>

#### <span class="font-mono">NewSessionResponse</span>

Response from creating a new session.

See protocol docs: [Creating a Session](https://agentclientprotocol.com/protocol/session-setup#creating-a-session)

**Type:** Object

**Properties:**

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  Unique identifier for the created session.

  Used in all subsequent requests for this conversation.
</ResponseField>

<a id="session-prompt" />

### <span class="font-mono">session/prompt</span>

Processes a user prompt within a session.

This method handles the whole lifecycle of a prompt:

* Receives user messages with optional context (files, images, etc.)
* Processes the prompt using language models
* Reports language model content and tool calls to the Clients
* Requests permission to run tools
* Executes any requested tool calls
* Returns when the turn is complete with a stop reason

See protocol docs: [Prompt Turn](https://agentclientprotocol.com/protocol/prompt-turn)

#### <span class="font-mono">PromptRequest</span>

Request parameters for sending a user prompt to the agent.

Contains the user's message and any additional context.

See protocol docs: [User Message](https://agentclientprotocol.com/protocol/prompt-turn#1-user-message)

**Type:** Object

**Properties:**

<ResponseField name="prompt" type={<><span><a href="#contentblock">ContentBlock</a></span><span>[]</span></>} required>
  The blocks of content that compose the user's message.

  As a baseline, the Agent MUST support `ContentBlock::Text` and `ContentBlock::ResourceLink`,
  while other variants are optionally enabled via `PromptCapabilities`.

  The Client MUST adapt its interface according to `PromptCapabilities`.

  The client MAY include referenced pieces of context as either
  `ContentBlock::Resource` or `ContentBlock::ResourceLink`.

  When available, `ContentBlock::Resource` is preferred
  as it avoids extra round-trips and allows the message to include
  pieces of context from sources the agent may not have access to.
</ResponseField>

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  The ID of the session to send this user message to
</ResponseField>

#### <span class="font-mono">PromptResponse</span>

Response from processing a user prompt.

See protocol docs: [Check for Completion](https://agentclientprotocol.com/protocol/prompt-turn#4-check-for-completion)

**Type:** Object

**Properties:**

<ResponseField name="stopReason" type={<a href="#stopreason">StopReason</a>} required>
  Indicates why the agent stopped processing the turn.
</ResponseField>

## Client

Defines the interface that ACP-compliant clients must implement.

Clients are typically code editors (IDEs, text editors) that provide the interface
between users and AI agents. They manage the environment, handle user interactions,
and control access to resources.

<a id="fs-read_text_file" />

### <span class="font-mono">fs/read\_text\_file</span>

Reads content from a text file in the client's file system.

Only available if the client advertises the `fs.readTextFile` capability.
Allows the agent to access file contents within the client's environment.

See protocol docs: [Client](https://agentclientprotocol.com/protocol/overview#client)

#### <span class="font-mono">ReadTextFileRequest</span>

Request to read content from a text file.

Only available if the client supports the `fs.readTextFile` capability.

**Type:** Object

**Properties:**

<ResponseField name="limit" type={"integer | null"}>
  Optional maximum number of lines to read.

  * Minimum: `0`
</ResponseField>

<ResponseField name="line" type={"integer | null"}>
  Optional line number to start reading from (1-based).

  * Minimum: `0`
</ResponseField>

<ResponseField name="path" type={"string"} required>
  Absolute path to the file to read.
</ResponseField>

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  The session ID for this request.
</ResponseField>

<a id="fs-write_text_file" />

### <span class="font-mono">fs/write\_text\_file</span>

Writes content to a text file in the client's file system.

Only available if the client advertises the `fs.writeTextFile` capability.
Allows the agent to create or modify files within the client's environment.

See protocol docs: [Client](https://agentclientprotocol.com/protocol/overview#client)

#### <span class="font-mono">WriteTextFileRequest</span>

Request to write content to a text file.

Only available if the client supports the `fs.writeTextFile` capability.

**Type:** Object

**Properties:**

<ResponseField name="content" type={"string"} required>
  The text content to write to the file.
</ResponseField>

<ResponseField name="path" type={"string"} required>
  Absolute path to the file to write.
</ResponseField>

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  The session ID for this request.
</ResponseField>

<a id="session-request_permission" />

### <span class="font-mono">session/request\_permission</span>

Requests permission from the user for a tool call operation.

Called by the agent when it needs user authorization before executing
a potentially sensitive operation. The client should present the options
to the user and return their decision.

If the client cancels the prompt turn via `session/cancel`, it MUST
respond to this request with `RequestPermissionOutcome::Cancelled`.

See protocol docs: [Requesting Permission](https://agentclientprotocol.com/protocol/tool-calls#requesting-permission)

#### <span class="font-mono">RequestPermissionRequest</span>

Request for user permission to execute a tool call.

Sent when the agent needs authorization before performing a sensitive operation.

See protocol docs: [Requesting Permission](https://agentclientprotocol.com/protocol/tool-calls#requesting-permission)

**Type:** Object

**Properties:**

<ResponseField
  name="options"
  type={
  <>
    <span>
      <a href="#permissionoption">PermissionOption</a>
    </span>
    <span>[]</span>
  </>
}
  required
>
  Available permission options for the user to choose from.
</ResponseField>

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  The session ID for this request.
</ResponseField>

<ResponseField name="toolCall" type={<a href="#toolcallupdate">ToolCallUpdate</a>} required>
  Details about the tool call requiring permission.
</ResponseField>

#### <span class="font-mono">RequestPermissionResponse</span>

Response to a permission request.

**Type:** Object

**Properties:**

<ResponseField name="outcome" type={<a href="#requestpermissionoutcome">RequestPermissionOutcome</a>} required>
  The user's decision on the permission request.
</ResponseField>

<a id="session-update" />

### <span class="font-mono">session/update</span>

Handles session update notifications from the agent.

This is a notification endpoint (no response expected) that receives
real-time updates about session progress, including message chunks,
tool calls, and execution plans.

Note: Clients SHOULD continue accepting tool call updates even after
sending a `session/cancel` notification, as the agent may send final
updates before responding with the cancelled stop reason.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/prompt-turn#3-agent-reports-output)

#### <span class="font-mono">SessionNotification</span>

Notification containing a session update from the agent.

Used to stream real-time progress and results during prompt processing.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/prompt-turn#3-agent-reports-output)

**Type:** Object

**Properties:**

<ResponseField name="sessionId" type={<a href="#sessionid">SessionId</a>} required>
  The ID of the session this update pertains to.
</ResponseField>

<ResponseField name="update" type={<a href="#sessionupdate">SessionUpdate</a>} required>
  The actual update content.
</ResponseField>

## <span class="font-mono">AgentCapabilities</span>

Capabilities supported by the agent.

Advertised during initialization to inform the client about
available features and content types.

See protocol docs: [Agent Capabilities](https://agentclientprotocol.com/protocol/initialization#agent-capabilities)

**Type:** Object

**Properties:**

<ResponseField name="loadSession" type={"boolean"}>
  Whether the agent supports `session/load`.

  * Default: `false`
</ResponseField>

<ResponseField name="promptCapabilities" type={<a href="#promptcapabilities">PromptCapabilities</a>}>
  Prompt capabilities supported by the agent.

  * Default: `{"audio":false,"embeddedContext":false,"image":false}`
</ResponseField>

## <span class="font-mono">Annotations</span>

Optional annotations for the client. The client can use annotations to inform how objects are used or displayed

**Type:** Object

**Properties:**

<ResponseField name="audience" type={"array | null"} />

<ResponseField name="lastModified" type={"string | null"} />

<ResponseField name="priority" type={"number | null"} />

## <span class="font-mono">AudioContent</span>

Audio provided to or from an LLM.

**Type:** Object

**Properties:**

<ResponseField
  name="annotations"
  type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
/>

<ResponseField name="data" type={"string"} required />

<ResponseField name="mimeType" type={"string"} required />

## <span class="font-mono">AuthMethod</span>

Describes an available authentication method.

**Type:** Object

**Properties:**

<ResponseField name="description" type={"string | null"}>
  Optional description providing more details about this authentication method.
</ResponseField>

<ResponseField name="id" type={<a href="#authmethodid">AuthMethodId</a>} required>
  Unique identifier for this authentication method.
</ResponseField>

<ResponseField name="name" type={"string"} required>
  Human-readable name of the authentication method.
</ResponseField>

## <span class="font-mono">AuthMethodId</span>

Unique identifier for an authentication method.

**Type:** `string`

## <span class="font-mono">BlobResourceContents</span>

Binary resource contents.

**Type:** Object

**Properties:**

<ResponseField name="blob" type={"string"} required />

<ResponseField name="mimeType" type={"string | null"} />

<ResponseField name="uri" type={"string"} required />

## <span class="font-mono">ClientCapabilities</span>

Capabilities supported by the client.

Advertised during initialization to inform the agent about
available features and methods.

See protocol docs: [Client Capabilities](https://agentclientprotocol.com/protocol/initialization#client-capabilities)

**Type:** Object

**Properties:**

<ResponseField name="fs" type={<a href="#filesystemcapability">FileSystemCapability</a>}>
  File system capabilities supported by the client.
  Determines which file operations the agent can request.

  * Default: `{"readTextFile":false,"writeTextFile":false}`
</ResponseField>

<ResponseField name="terminal" type={"boolean"}>
  **UNSTABLE**

  This capability is not part of the spec yet, and may be removed or changed at any point.

  * Default: `false`
</ResponseField>

## <span class="font-mono">ContentBlock</span>

Content blocks represent displayable information in the Agent Client Protocol.

They provide a structured way to handle various types of user-facing content—whether
it's text from language models, images for analysis, or embedded resources for context.

Content blocks appear in:

* User prompts sent via `session/prompt`
* Language model output streamed through `session/update` notifications
* Progress updates and results from tool calls

This structure is compatible with the Model Context Protocol (MCP), enabling
agents to seamlessly forward content from MCP tool outputs without transformation.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/content)

**Type:** Union

<ResponseField name="text">
  Plain text content

  All agents MUST support text content blocks in prompts.

  <Expandable title="Properties">
    <ResponseField
      name="annotations"
      type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
    />

    <ResponseField name="text" type={"string"} required />

    <ResponseField name="type" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="image">
  Images for visual context or analysis.

  Requires the `image` prompt capability when included in prompts.

  <Expandable title="Properties">
    <ResponseField
      name="annotations"
      type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
    />

    <ResponseField name="data" type={"string"} required />

    <ResponseField name="mimeType" type={"string"} required />

    <ResponseField name="type" type={"string"} required />

    <ResponseField name="uri" type={"string | null"} />
  </Expandable>
</ResponseField>

<ResponseField name="audio">
  Audio data for transcription or analysis.

  Requires the `audio` prompt capability when included in prompts.

  <Expandable title="Properties">
    <ResponseField
      name="annotations"
      type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
    />

    <ResponseField name="data" type={"string"} required />

    <ResponseField name="mimeType" type={"string"} required />

    <ResponseField name="type" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="resource_link">
  References to resources that the agent can access.

  All agents MUST support resource links in prompts.

  <Expandable title="Properties">
    <ResponseField
      name="annotations"
      type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
    />

    <ResponseField name="description" type={"string | null"} />

    <ResponseField name="mimeType" type={"string | null"} />

    <ResponseField name="name" type={"string"} required />

    <ResponseField name="size" type={"integer | null"} />

    <ResponseField name="title" type={"string | null"} />

    <ResponseField name="type" type={"string"} required />

    <ResponseField name="uri" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="resource">
  Complete resource contents embedded directly in the message.

  Preferred for including context as it avoids extra round-trips.

  Requires the `embeddedContext` prompt capability when included in prompts.

  <Expandable title="Properties">
    <ResponseField
      name="annotations"
      type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
    />

    <ResponseField name="resource" type={<a href="#embeddedresourceresource">EmbeddedResourceResource</a>} required />

    <ResponseField name="type" type={"string"} required />
  </Expandable>
</ResponseField>

## <span class="font-mono">EmbeddedResource</span>

The contents of a resource, embedded into a prompt or tool call result.

**Type:** Object

**Properties:**

<ResponseField
  name="annotations"
  type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
/>

<ResponseField name="resource" type={<a href="#embeddedresourceresource">EmbeddedResourceResource</a>} required />

## <span class="font-mono">EmbeddedResourceResource</span>

Resource content that can be embedded in a message.

**Type:** Union

<ResponseField name="TextResourceContents">
  {""}

  <Expandable title="Properties">
    <ResponseField name="mimeType" type={"string | null"} />

    <ResponseField name="text" type={"string"} required />

    <ResponseField name="uri" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="BlobResourceContents">
  {""}

  <Expandable title="Properties">
    <ResponseField name="blob" type={"string"} required />

    <ResponseField name="mimeType" type={"string | null"} />

    <ResponseField name="uri" type={"string"} required />
  </Expandable>
</ResponseField>

## <span class="font-mono">EnvVariable</span>

An environment variable to set when launching an MCP server.

**Type:** Object

**Properties:**

<ResponseField name="name" type={"string"} required>
  The name of the environment variable.
</ResponseField>

<ResponseField name="value" type={"string"} required>
  The value to set for the environment variable.
</ResponseField>

## <span class="font-mono">FileSystemCapability</span>

File system capabilities that a client may support.

See protocol docs: [FileSystem](https://agentclientprotocol.com/protocol/initialization#filesystem)

**Type:** Object

**Properties:**

<ResponseField name="readTextFile" type={"boolean"}>
  Whether the Client supports `fs/read_text_file` requests.

  * Default: `false`
</ResponseField>

<ResponseField name="writeTextFile" type={"boolean"}>
  Whether the Client supports `fs/write_text_file` requests.

  * Default: `false`
</ResponseField>

## <span class="font-mono">ImageContent</span>

An image provided to or from an LLM.

**Type:** Object

**Properties:**

<ResponseField
  name="annotations"
  type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
/>

<ResponseField name="data" type={"string"} required />

<ResponseField name="mimeType" type={"string"} required />

<ResponseField name="uri" type={"string | null"} />

## <span class="font-mono">McpServer</span>

Configuration for connecting to an MCP (Model Context Protocol) server.

MCP servers provide tools and context that the agent can use when
processing prompts.

See protocol docs: [MCP Servers](https://agentclientprotocol.com/protocol/session-setup#mcp-servers)

**Type:** Object

**Properties:**

<ResponseField
  name="args"
  type={
  <>
    <span>"string"</span>
    <span>[]</span>
  </>
}
  required
>
  Command-line arguments to pass to the MCP server.
</ResponseField>

<ResponseField name="command" type={"string"} required>
  Path to the MCP server executable.
</ResponseField>

<ResponseField
  name="env"
  type={
  <>
    <span>
      <a href="#envvariable">EnvVariable</a>
    </span>
    <span>[]</span>
  </>
}
  required
>
  Environment variables to set when launching the MCP server.
</ResponseField>

<ResponseField name="name" type={"string"} required>
  Human-readable name identifying this MCP server.
</ResponseField>

## <span class="font-mono">PermissionOption</span>

An option presented to the user when requesting permission.

**Type:** Object

**Properties:**

<ResponseField name="kind" type={<a href="#permissionoptionkind">PermissionOptionKind</a>} required>
  Hint about the nature of this permission option.
</ResponseField>

<ResponseField name="name" type={"string"} required>
  Human-readable label to display to the user.
</ResponseField>

<ResponseField name="optionId" type={<a href="#permissionoptionid">PermissionOptionId</a>} required>
  Unique identifier for this permission option.
</ResponseField>

## <span class="font-mono">PermissionOptionId</span>

Unique identifier for a permission option.

**Type:** `string`

## <span class="font-mono">PermissionOptionKind</span>

The type of permission option being presented to the user.

Helps clients choose appropriate icons and UI treatment.

**Type:** Union

<ResponseField name="allow_once">
  Allow this operation only this time.
</ResponseField>

<ResponseField name="allow_always">
  Allow this operation and remember the choice.
</ResponseField>

<ResponseField name="reject_once">
  Reject this operation only this time.
</ResponseField>

<ResponseField name="reject_always">
  Reject this operation and remember the choice.
</ResponseField>

## <span class="font-mono">Plan</span>

An execution plan for accomplishing complex tasks.

Plans consist of multiple entries representing individual tasks or goals.
Agents report plans to clients to provide visibility into their execution strategy.
Plans can evolve during execution as the agent discovers new requirements or completes tasks.

See protocol docs: [Agent Plan](https://agentclientprotocol.com/protocol/agent-plan)

**Type:** Object

**Properties:**

<ResponseField name="entries" type={<><span><a href="#planentry">PlanEntry</a></span><span>[]</span></>} required>
  The list of tasks to be accomplished.

  When updating a plan, the agent must send a complete list of all entries
  with their current status. The client replaces the entire plan with each update.
</ResponseField>

## <span class="font-mono">PlanEntry</span>

A single entry in the execution plan.

Represents a task or goal that the assistant intends to accomplish
as part of fulfilling the user's request.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)

**Type:** Object

**Properties:**

<ResponseField name="content" type={"string"} required>
  Human-readable description of what this task aims to accomplish.
</ResponseField>

<ResponseField name="priority" type={<a href="#planentrypriority">PlanEntryPriority</a>} required>
  The relative importance of this task. Used to indicate which tasks are most
  critical to the overall goal.
</ResponseField>

<ResponseField name="status" type={<a href="#planentrystatus">PlanEntryStatus</a>} required>
  Current execution status of this task.
</ResponseField>

## <span class="font-mono">PlanEntryPriority</span>

Priority levels for plan entries.

Used to indicate the relative importance or urgency of different
tasks in the execution plan.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)

**Type:** Union

<ResponseField name="high">
  High priority task - critical to the overall goal.
</ResponseField>

<ResponseField name="medium">
  Medium priority task - important but not critical.
</ResponseField>

<ResponseField name="low">
  Low priority task - nice to have but not essential.
</ResponseField>

## <span class="font-mono">PlanEntryStatus</span>

Status of a plan entry in the execution flow.

Tracks the lifecycle of each task from planning through completion.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)

**Type:** Union

<ResponseField name="pending">The task has not started yet.</ResponseField>

<ResponseField name="in_progress">
  The task is currently being worked on.
</ResponseField>

<ResponseField name="completed">
  The task has been successfully completed.
</ResponseField>

## <span class="font-mono">PromptCapabilities</span>

Prompt capabilities supported by the agent in `session/prompt` requests.

Baseline agent functionality requires support for `ContentBlock::Text`
and `ContentBlock::ResourceLink` in prompt requests.

Other variants must be explicitly opted in to.
Capabilities for different types of content in prompt requests.

Indicates which content types beyond the baseline (text and resource links)
the agent can process.

See protocol docs: [Prompt Capabilities](https://agentclientprotocol.com/protocol/initialization#prompt-capabilities)

**Type:** Object

**Properties:**

<ResponseField name="audio" type={"boolean"}>
  Agent supports `ContentBlock::Audio`.

  * Default: `false`
</ResponseField>

<ResponseField name="embeddedContext" type={"boolean"}>
  Agent supports embedded context in `session/prompt` requests.

  When enabled, the Client is allowed to include `ContentBlock::Resource`
  in prompt requests for pieces of context that are referenced in the message.

  * Default: `false`
</ResponseField>

<ResponseField name="image" type={"boolean"}>
  Agent supports `ContentBlock::Image`.

  * Default: `false`
</ResponseField>

## <span class="font-mono">ProtocolVersion</span>

Protocol version identifier.

This version is only bumped for breaking changes.
Non-breaking changes should be introduced via capabilities.

**Type:** `integer (uint16)`

| Constraint | Value   |
| ---------- | ------- |
| Minimum    | `0`     |
| Maximum    | `65535` |

## <span class="font-mono">ReadTextFileResponse</span>

Response containing the contents of a text file.

**Type:** Object

**Properties:**

<ResponseField name="content" type={"string"} required />

## <span class="font-mono">RequestPermissionOutcome</span>

The outcome of a permission request.

**Type:** Union

<ResponseField name="cancelled">
  The prompt turn was cancelled before the user responded.

  When a client sends a `session/cancel` notification to cancel an ongoing
  prompt turn, it MUST respond to all pending `session/request_permission`
  requests with this `Cancelled` outcome.

  See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/prompt-turn#cancellation)

  <Expandable title="Properties">
    <ResponseField name="outcome" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="selected">
  The user selected one of the provided options.

  <Expandable title="Properties">
    <ResponseField name="optionId" type={<a href="#permissionoptionid">PermissionOptionId</a>} required>
      The ID of the option the user selected.
    </ResponseField>

    <ResponseField name="outcome" type={"string"} required />
  </Expandable>
</ResponseField>

## <span class="font-mono">ResourceLink</span>

A resource that the server is capable of reading, included in a prompt or tool call result.

**Type:** Object

**Properties:**

<ResponseField
  name="annotations"
  type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
/>

<ResponseField name="description" type={"string | null"} />

<ResponseField name="mimeType" type={"string | null"} />

<ResponseField name="name" type={"string"} required />

<ResponseField name="size" type={"integer | null"} />

<ResponseField name="title" type={"string | null"} />

<ResponseField name="uri" type={"string"} required />

## <span class="font-mono">Role</span>

The sender or recipient of messages and data in a conversation.

**Type:** Enumeration

| Value         |
| ------------- |
| `"assistant"` |
| `"user"`      |

## <span class="font-mono">SessionId</span>

A unique identifier for a conversation session between a client and agent.

Sessions maintain their own context, conversation history, and state,
allowing multiple independent interactions with the same agent.

\# Example

```
use agent_client_protocol::SessionId;
use std::sync::Arc;

let session_id = SessionId(Arc::from("sess_abc123def456"));
```

See protocol docs: [Session ID](https://agentclientprotocol.com/protocol/session-setup#session-id)

**Type:** `string`

## <span class="font-mono">SessionUpdate</span>

Different types of updates that can be sent during session processing.

These updates provide real-time feedback about the agent's progress.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/prompt-turn#3-agent-reports-output)

**Type:** Union

<ResponseField name="user_message_chunk">
  A chunk of the user's message being streamed.

  <Expandable title="Properties">
    <ResponseField name="content" type={<a href="#contentblock">ContentBlock</a>} required />

    <ResponseField name="sessionUpdate" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="agent_message_chunk">
  A chunk of the agent's response being streamed.

  <Expandable title="Properties">
    <ResponseField name="content" type={<a href="#contentblock">ContentBlock</a>} required />

    <ResponseField name="sessionUpdate" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="agent_thought_chunk">
  A chunk of the agent's internal reasoning being streamed.

  <Expandable title="Properties">
    <ResponseField name="content" type={<a href="#contentblock">ContentBlock</a>} required />

    <ResponseField name="sessionUpdate" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="tool_call">
  Notification that a new tool call has been initiated.

  <Expandable title="Properties">
    <ResponseField
      name="content"
      type={
  <>
    <span>
      <a href="#toolcallcontent">ToolCallContent</a>
    </span>
    <span>[]</span>
  </>
}
    >
      Content produced by the tool call.
    </ResponseField>

    <ResponseField name="kind" type={<a href="#toolkind">ToolKind</a>}>
      The category of tool being invoked. Helps clients choose appropriate icons and
      UI treatment.
    </ResponseField>

    <ResponseField
      name="locations"
      type={
  <>
    <span>
      <a href="#toolcalllocation">ToolCallLocation</a>
    </span>
    <span>[]</span>
  </>
}
    >
      File locations affected by this tool call. Enables "follow-along" features in
      clients.
    </ResponseField>

    <ResponseField name="rawInput" type={"object"}>
      Raw input parameters sent to the tool.
    </ResponseField>

    <ResponseField name="rawOutput" type={"object"}>
      Raw output returned by the tool.
    </ResponseField>

    <ResponseField name="sessionUpdate" type={"string"} required />

    <ResponseField name="status" type={<a href="#toolcallstatus">ToolCallStatus</a>}>
      Current execution status of the tool call.
    </ResponseField>

    <ResponseField name="title" type={"string"} required>
      Human-readable title describing what the tool is doing.
    </ResponseField>

    <ResponseField name="toolCallId" type={<a href="#toolcallid">ToolCallId</a>} required>
      Unique identifier for this tool call within the session.
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="tool_call_update">
  Update on the status or results of a tool call.

  <Expandable title="Properties">
    <ResponseField name="content" type={"array | null"}>
      Replace the content collection.
    </ResponseField>

    <ResponseField
      name="kind"
      type={
  <>
    <span>
      <a href="#toolkind">ToolKind</a>
    </span>
    <span> | null</span>
  </>
}
    >
      Update the tool kind.
    </ResponseField>

    <ResponseField name="locations" type={"array | null"}>
      Replace the locations collection.
    </ResponseField>

    <ResponseField name="rawInput" type={"object"}>
      Update the raw input.
    </ResponseField>

    <ResponseField name="rawOutput" type={"object"}>
      Update the raw output.
    </ResponseField>

    <ResponseField name="sessionUpdate" type={"string"} required />

    <ResponseField
      name="status"
      type={
  <>
    <span>
      <a href="#toolcallstatus">ToolCallStatus</a>
    </span>
    <span> | null</span>
  </>
}
    >
      Update the execution status.
    </ResponseField>

    <ResponseField name="title" type={"string | null"}>
      Update the human-readable title.
    </ResponseField>

    <ResponseField name="toolCallId" type={<a href="#toolcallid">ToolCallId</a>} required>
      The ID of the tool call being updated.
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="plan">
  The agent's execution plan for complex tasks.
  See protocol docs: [Agent Plan](https://agentclientprotocol.com/protocol/agent-plan)

  <Expandable title="Properties">
    <ResponseField name="entries" type={<><span><a href="#planentry">PlanEntry</a></span><span>[]</span></>} required>
      The list of tasks to be accomplished.

      When updating a plan, the agent must send a complete list of all entries
      with their current status. The client replaces the entire plan with each update.
    </ResponseField>

    <ResponseField name="sessionUpdate" type={"string"} required />
  </Expandable>
</ResponseField>

## <span class="font-mono">StopReason</span>

Reasons why an agent stops processing a prompt turn.

See protocol docs: [Stop Reasons](https://agentclientprotocol.com/protocol/prompt-turn#stop-reasons)

**Type:** Union

<ResponseField name="end_turn">The turn ended successfully.</ResponseField>

<ResponseField name="max_tokens">
  The turn ended because the agent reached the maximum number of tokens.
</ResponseField>

<ResponseField name="max_turn_requests">
  The turn ended because the agent reached the maximum number of allowed agent
  requests between user turns.
</ResponseField>

<ResponseField name="refusal">
  The turn ended because the agent refused to continue. The user prompt and
  everything that comes after it won't be included in the next prompt, so this
  should be reflected in the UI.
</ResponseField>

<ResponseField name="cancelled">
  The turn was cancelled by the client via `session/cancel`.

  This stop reason MUST be returned when the client sends a `session/cancel`
  notification, even if the cancellation causes exceptions in underlying operations.
  Agents should catch these exceptions and return this semantically meaningful
  response to confirm successful cancellation.
</ResponseField>

## <span class="font-mono">TextContent</span>

Text provided to or from an LLM.

**Type:** Object

**Properties:**

<ResponseField
  name="annotations"
  type={
  <>
    <span>
      <a href="#annotations">Annotations</a>
    </span>
    <span> | null</span>
  </>
}
/>

<ResponseField name="text" type={"string"} required />

## <span class="font-mono">TextResourceContents</span>

Text-based resource contents.

**Type:** Object

**Properties:**

<ResponseField name="mimeType" type={"string | null"} />

<ResponseField name="text" type={"string"} required />

<ResponseField name="uri" type={"string"} required />

## <span class="font-mono">ToolCall</span>

Represents a tool call that the language model has requested.

Tool calls are actions that the agent executes on behalf of the language model,
such as reading files, executing code, or fetching data from external sources.

See protocol docs: [Tool Calls](https://agentclientprotocol.com/protocol/tool-calls)

**Type:** Object

**Properties:**

<ResponseField
  name="content"
  type={
  <>
    <span>
      <a href="#toolcallcontent">ToolCallContent</a>
    </span>
    <span>[]</span>
  </>
}
>
  Content produced by the tool call.
</ResponseField>

<ResponseField name="kind" type={<a href="#toolkind">ToolKind</a>}>
  The category of tool being invoked. Helps clients choose appropriate icons and
  UI treatment.
</ResponseField>

<ResponseField
  name="locations"
  type={
  <>
    <span>
      <a href="#toolcalllocation">ToolCallLocation</a>
    </span>
    <span>[]</span>
  </>
}
>
  File locations affected by this tool call. Enables "follow-along" features in
  clients.
</ResponseField>

<ResponseField name="rawInput" type={"object"}>
  Raw input parameters sent to the tool.
</ResponseField>

<ResponseField name="rawOutput" type={"object"}>
  Raw output returned by the tool.
</ResponseField>

<ResponseField name="status" type={<a href="#toolcallstatus">ToolCallStatus</a>}>
  Current execution status of the tool call.
</ResponseField>

<ResponseField name="title" type={"string"} required>
  Human-readable title describing what the tool is doing.
</ResponseField>

<ResponseField name="toolCallId" type={<a href="#toolcallid">ToolCallId</a>} required>
  Unique identifier for this tool call within the session.
</ResponseField>

## <span class="font-mono">ToolCallContent</span>

Content produced by a tool call.

Tool calls can produce different types of content including
standard content blocks (text, images) or file diffs.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/tool-calls#content)

**Type:** Union

<ResponseField name="content">
  Standard content block (text, images, resources).

  <Expandable title="Properties">
    <ResponseField name="content" type={<a href="#contentblock">ContentBlock</a>} required>
      The actual content block.
    </ResponseField>

    <ResponseField name="type" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="diff">
  File modification shown as a diff.

  <Expandable title="Properties">
    <ResponseField name="newText" type={"string"} required>
      The new content after modification.
    </ResponseField>

    <ResponseField name="oldText" type={"string | null"}>
      The original content (None for new files).
    </ResponseField>

    <ResponseField name="path" type={"string"} required>
      The file path being modified.
    </ResponseField>

    <ResponseField name="type" type={"string"} required />
  </Expandable>
</ResponseField>

<ResponseField name="terminal">
  {""}

  <Expandable title="Properties">
    <ResponseField name="terminalId" type={"string"} required />

    <ResponseField name="type" type={"string"} required />
  </Expandable>
</ResponseField>

## <span class="font-mono">ToolCallId</span>

Unique identifier for a tool call within a session.

**Type:** `string`

## <span class="font-mono">ToolCallLocation</span>

A file location being accessed or modified by a tool.

Enables clients to implement "follow-along" features that track
which files the agent is working with in real-time.

See protocol docs: [Following the Agent](https://agentclientprotocol.com/protocol/tool-calls#following-the-agent)

**Type:** Object

**Properties:**

<ResponseField name="line" type={"integer | null"}>
  Optional line number within the file.

  * Minimum: `0`
</ResponseField>

<ResponseField name="path" type={"string"} required>
  The file path being accessed or modified.
</ResponseField>

## <span class="font-mono">ToolCallStatus</span>

Execution status of a tool call.

Tool calls progress through different statuses during their lifecycle.

See protocol docs: [Status](https://agentclientprotocol.com/protocol/tool-calls#status)

**Type:** Union

<ResponseField name="pending">
  The tool call hasn't started running yet because the input is either streaming
  or we're awaiting approval.
</ResponseField>

<ResponseField name="in_progress">
  The tool call is currently running.
</ResponseField>

<ResponseField name="completed">
  The tool call completed successfully.
</ResponseField>

<ResponseField name="failed">The tool call failed with an error.</ResponseField>

## <span class="font-mono">ToolCallUpdate</span>

An update to an existing tool call.

Used to report progress and results as tools execute. All fields except
the tool call ID are optional - only changed fields need to be included.

See protocol docs: [Updating](https://agentclientprotocol.com/protocol/tool-calls#updating)

**Type:** Object

**Properties:**

<ResponseField name="content" type={"array | null"}>
  Replace the content collection.
</ResponseField>

<ResponseField
  name="kind"
  type={
  <>
    <span>
      <a href="#toolkind">ToolKind</a>
    </span>
    <span> | null</span>
  </>
}
>
  Update the tool kind.
</ResponseField>

<ResponseField name="locations" type={"array | null"}>
  Replace the locations collection.
</ResponseField>

<ResponseField name="rawInput" type={"object"}>
  Update the raw input.
</ResponseField>

<ResponseField name="rawOutput" type={"object"}>
  Update the raw output.
</ResponseField>

<ResponseField
  name="status"
  type={
  <>
    <span>
      <a href="#toolcallstatus">ToolCallStatus</a>
    </span>
    <span> | null</span>
  </>
}
>
  Update the execution status.
</ResponseField>

<ResponseField name="title" type={"string | null"}>
  Update the human-readable title.
</ResponseField>

<ResponseField name="toolCallId" type={<a href="#toolcallid">ToolCallId</a>} required>
  The ID of the tool call being updated.
</ResponseField>

## <span class="font-mono">ToolKind</span>

Categories of tools that can be invoked.

Tool kinds help clients choose appropriate icons and optimize how they
display tool execution progress.

See protocol docs: [Creating](https://agentclientprotocol.com/protocol/tool-calls#creating)

**Type:** Union

<ResponseField name="read">Reading files or data.</ResponseField>

<ResponseField name="edit">Modifying files or content.</ResponseField>

<ResponseField name="delete">Removing files or data.</ResponseField>

<ResponseField name="move">Moving or renaming files.</ResponseField>

<ResponseField name="search">Searching for information.</ResponseField>

<ResponseField name="execute">Running commands or code.</ResponseField>

<ResponseField name="think">Internal reasoning or planning.</ResponseField>

<ResponseField name="fetch">Retrieving external data.</ResponseField>

<ResponseField name="other">Other tool types (default).</ResponseField>
