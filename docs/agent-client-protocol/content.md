# Content

> Understanding content blocks in the Agent Client Protocol

Content blocks represent displayable information that flows through the Agent Client Protocol. They provide a structured way to handle various types of user-facing content—whether it's text from language models, images for analysis, or embedded resources for context.

Content blocks appear in:

* User prompts sent via [`session/prompt`](./prompt-turn#1-user-message)
* Language model output streamed through [`session/update`](./prompt-turn#3-agent-reports-output) notifications
* Progress updates and results from [tool calls](./tool-calls)

## Content Types

The Agent Client Protocol uses the same `ContentBlock` structure as the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/specification/2025-06-18/schema#contentblock).

This design choice enables Agents to seamlessly forward content from MCP tool outputs without transformation.

### Text Content

Plain text messages form the foundation of most interactions.

```json
{
  "type": "text",
  "text": "What's the weather like today?"
}
```

All Agents **MUST** support text content blocks when included in prompts.

<ParamField path="text" type="string" required>
  The text content to display
</ParamField>

<ParamField path="annotations" type="Annotations">
  Optional metadata about how the content should be used or displayed. [Learn
  more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).
</ParamField>

### Image Content <Icon icon="asterisk" size="14" />

Images can be included for visual context or analysis.

```json
{
  "type": "image",
  "mimeType": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
}
```

<Icon icon="asterisk" size="14" /> Requires the `image` [prompt
capability](./initialization#prompt-capabilities) when included in prompts.

<ParamField path="data" type="string" required>
  Base64-encoded image data
</ParamField>

<ParamField path="mimeType" type="string" required>
  The MIME type of the image (e.g., "image/png", "image/jpeg")
</ParamField>

<ParamField path="uri" type="string">
  Optional URI reference for the image source
</ParamField>

<ParamField path="annotations" type="Annotations">
  Optional metadata about how the content should be used or displayed. [Learn
  more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).
</ParamField>

### Audio Content <Icon icon="asterisk" size="14" />

Audio data for transcription or analysis.

```json
{
  "type": "audio",
  "mimeType": "audio/wav",
  "data": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB..."
}
```

<Icon icon="asterisk" size="14" /> Requires the `audio` [prompt
capability](./initialization#prompt-capabilities) when included in prompts.

<ParamField path="data" type="string" required>
  Base64-encoded audio data
</ParamField>

<ParamField path="mimeType" type="string" required>
  The MIME type of the audio (e.g., "audio/wav", "audio/mp3")
</ParamField>

<ParamField path="annotations" type="Annotations">
  Optional metadata about how the content should be used or displayed. [Learn
  more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).
</ParamField>

### Embedded Resource <Icon icon="asterisk" size="14" />

Complete resource contents embedded directly in the message.

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///home/user/script.py",
    "mimeType": "text/x-python",
    "text": "def hello():\n    print('Hello, world!')"
  }
}
```

This is the preferred way to include context in prompts, such as when using @-mentions to reference files or other resources.

By embedding the content directly in the request, Clients can include context from sources that the Agent may not have direct access to.

<Icon icon="asterisk" size="14" /> Requires the `embeddedContext` [prompt
capability](./initialization#prompt-capabilities) when included in prompts.

<ParamField path="resource" type="EmbeddedResourceResource" required>
  The embedded resource contents, which can be either:

  <Expandable title="Text Resource">
    <ParamField path="uri" type="string" required>
      The URI identifying the resource
    </ParamField>

    <ParamField path="text" type="string" required>
      The text content of the resource
    </ParamField>

    <ParamField path="mimeType" type="string">
      Optional MIME type of the text content
    </ParamField>
  </Expandable>

  <Expandable title="Blob Resource">
    <ParamField path="uri" type="string" required>
      The URI identifying the resource
    </ParamField>

    <ParamField path="blob" type="string" required>
      Base64-encoded binary data
    </ParamField>

    <ParamField path="mimeType" type="string">
      Optional MIME type of the blob
    </ParamField>
  </Expandable>
</ParamField>

<ParamField path="annotations" type="Annotations">
  Optional metadata about how the content should be used or displayed. [Learn
  more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).
</ParamField>

### Resource Link

References to resources that the Agent can access.

```json
{
  "type": "resource_link",
  "uri": "file:///home/user/document.pdf",
  "name": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000
}
```

<ParamField path="uri" type="string" required>
  The URI of the resource
</ParamField>

<ParamField path="name" type="string" required>
  A human-readable name for the resource
</ParamField>

<ParamField path="mimeType" type="string">
  The MIME type of the resource
</ParamField>

<ParamField path="title" type="string">
  Optional display title for the resource
</ParamField>

<ParamField path="description" type="string">
  Optional description of the resource contents
</ParamField>

<ParamField path="size" type="integer">
  Optional size of the resource in bytes
</ParamField>

<ParamField path="annotations" type="Annotations">
  Optional metadata about how the content should be used or displayed. [Learn
  more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).
</ParamField>
