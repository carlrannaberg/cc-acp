import {
  contentBlockSchema,
  sessionUpdateSchema,
  initializeRequestSchema,
  initializeResponseSchema,
  newSessionRequestSchema,
  promptRequestSchema,
  requestPermissionRequestSchema,
  readTextFileRequestSchema,
  writeTextFileRequestSchema,
  type ContentBlock,
  type SessionUpdate,
  type InitializeRequest
} from '../protocol/schemas';

describe('ACP Schema Validation', () => {
  describe('contentBlockSchema', () => {
    it('should validate text content block', () => {
      const textContent: ContentBlock = {
        type: 'text',
        text: 'Hello, world!'
      };
      expect(() => contentBlockSchema.parse(textContent)).not.toThrow();
    });

    it('should validate image content block', () => {
      const imageContent: ContentBlock = {
        type: 'image',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        mimeType: 'image/png'
      };
      expect(() => contentBlockSchema.parse(imageContent)).not.toThrow();
    });

    it('should validate resource link content block', () => {
      const resourceContent: ContentBlock = {
        type: 'resource_link',
        uri: 'https://example.com/file.txt',
        name: 'file.txt',
        mimeType: 'text/plain'
      };
      expect(() => contentBlockSchema.parse(resourceContent)).not.toThrow();
    });

    it('should reject invalid content type', () => {
      const invalidContent = {
        type: 'invalid',
        text: 'Hello'
      };
      expect(() => contentBlockSchema.parse(invalidContent)).toThrow();
    });
  });

  describe('sessionUpdateSchema', () => {
    it('should validate agent_message_chunk', () => {
      const update: SessionUpdate = {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'Agent response'
        }
      };
      expect(() => sessionUpdateSchema.parse(update)).not.toThrow();
    });

    it('should validate tool_call update', () => {
      const toolCallUpdate: SessionUpdate = {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_123',
        title: 'Read File',
        status: 'in_progress',
        kind: 'read',
        content: [{
          type: 'content',
          content: {
            type: 'text',
            text: 'Reading file...'
          }
        }],
        locations: [{
          path: '/path/to/file.txt',
          line: 42
        }]
      };
      expect(() => sessionUpdateSchema.parse(toolCallUpdate)).not.toThrow();
    });

    it('should validate plan update', () => {
      const planUpdate: SessionUpdate = {
        sessionUpdate: 'plan',
        entries: [{
          content: 'Complete task 1',
          priority: 'high',
          status: 'pending'
        }]
      };
      expect(() => sessionUpdateSchema.parse(planUpdate)).not.toThrow();
    });
  });

  describe('initializeRequestSchema', () => {
    it('should validate initialize request', () => {
      const request: InitializeRequest = {
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true
          }
        },
        protocolVersion: 1
      };
      expect(() => initializeRequestSchema.parse(request)).not.toThrow();
    });
  });

  describe('promptRequestSchema', () => {
    it('should validate prompt request with valid UUID', () => {
      const request = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        prompt: [{
          type: 'text',
          text: 'Hello, assistant!'
        }]
      };
      expect(() => promptRequestSchema.parse(request)).not.toThrow();
    });

    it('should reject prompt request with missing sessionId', () => {
      const request = {
        // sessionId missing
        prompt: [{
          type: 'text',
          text: 'Hello, assistant!'
        }]
      };
      expect(() => promptRequestSchema.parse(request)).toThrow();
    });
  });

  describe('requestPermissionRequestSchema', () => {
    it('should validate permission request', () => {
      const request = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        toolCall: {
          toolCallId: 'call_123',
          title: 'Write File',
          kind: 'edit' as const,
          content: [{
            type: 'diff' as const,
            path: '/path/to/file.txt',
            oldText: 'old content',
            newText: 'new content'
          }]
        },
        options: [{
          optionId: 'allow_once',
          name: 'Allow Once',
          kind: 'allow_once' as const
        }]
      };
      expect(() => requestPermissionRequestSchema.parse(request)).not.toThrow();
    });
  });
});