import { z } from 'zod';

// Basic enum schemas
export const roleSchema = z.enum(['assistant', 'user']);

export const toolKindSchema = z.enum([
  'read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'
]);

export const toolCallStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

// Resource content schemas
export const textResourceContentsSchema = z.object({
  mimeType: z.string().optional().nullable(),
  text: z.string(),
  uri: z.string()
});

export const blobResourceContentsSchema = z.object({
  blob: z.string(),
  mimeType: z.string().optional().nullable(),
  uri: z.string()
});

export const embeddedResourceResourceSchema = z.union([
  textResourceContentsSchema,
  blobResourceContentsSchema
]);

// Content types with strict validation
export const annotationsSchema = z.object({
  audience: z.array(roleSchema).optional().nullable(),
  lastModified: z.string().optional().nullable(),
  priority: z.number().optional().nullable()
});

export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    annotations: annotationsSchema.optional().nullable()
  }),
  z.object({
    type: z.literal('image'),
    data: z.string(), // base64
    mimeType: z.string(),
    uri: z.string().optional().nullable(),
    annotations: annotationsSchema.optional().nullable()
  }),
  z.object({
    type: z.literal('audio'),
    data: z.string(),
    mimeType: z.string(),
    annotations: annotationsSchema.optional().nullable()
  }),
  z.object({
    type: z.literal('resource_link'),
    uri: z.string(),
    name: z.string(),
    title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    mimeType: z.string().optional().nullable(),
    size: z.number().optional().nullable(),
    annotations: annotationsSchema.optional().nullable()
  }),
  z.object({
    type: z.literal('resource'),
    resource: embeddedResourceResourceSchema,
    annotations: annotationsSchema.optional().nullable()
  })
]);

export const toolCallContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('content'),
    content: contentBlockSchema
  }),
  z.object({
    type: z.literal('diff'),
    path: z.string(),
    oldText: z.string().optional().nullable(),
    newText: z.string()
  })
]);

// Location and plan schemas needed for sessionUpdate
export const toolCallLocationSchema = z.object({
  path: z.string(),
  line: z.number().optional().nullable()
});

export const planEntrySchema = z.object({
  content: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'in_progress', 'completed'])
});

// Session updates with all variants
export const sessionUpdateSchema = z.discriminatedUnion('sessionUpdate', [
  z.object({
    sessionUpdate: z.literal('agent_message_chunk'),
    content: contentBlockSchema
  }),
  z.object({
    sessionUpdate: z.literal('user_message_chunk'),
    content: contentBlockSchema
  }),
  z.object({
    sessionUpdate: z.literal('agent_thought_chunk'),
    content: contentBlockSchema
  }),
  z.object({
    sessionUpdate: z.literal('tool_call'),
    toolCallId: z.string(),
    title: z.string(),
    status: toolCallStatusSchema.optional(),
    kind: toolKindSchema.optional(),
    content: z.array(toolCallContentSchema).optional(),
    locations: z.array(toolCallLocationSchema).optional(),
    rawInput: z.unknown().optional()
  }),
  z.object({
    sessionUpdate: z.literal('tool_call_update'),
    toolCallId: z.string(),
    title: z.string().optional().nullable(),
    status: toolCallStatusSchema.optional().nullable(),
    kind: toolKindSchema.optional().nullable(),
    content: z.array(toolCallContentSchema).optional().nullable(),
    locations: z.array(toolCallLocationSchema).optional().nullable(),
    rawInput: z.unknown().optional()
  }),
  z.object({
    sessionUpdate: z.literal('plan'),
    entries: z.array(planEntrySchema)
  })
]);

// Helper schemas for capabilities and configuration
export const fileSystemCapabilitySchema = z.object({
  readTextFile: z.boolean().optional(),
  writeTextFile: z.boolean().optional()
});

export const clientCapabilitiesSchema = z.object({
  fs: fileSystemCapabilitySchema.optional()
});

export const promptCapabilitiesSchema = z.object({
  image: z.boolean().optional(),
  audio: z.boolean().optional(),
  embeddedContext: z.boolean().optional()
});

export const authMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable()
});

export const agentCapabilitiesSchema = z.object({
  loadSession: z.boolean().optional(),
  promptCapabilities: promptCapabilitiesSchema.optional()
});

export const envVariableSchema = z.object({
  name: z.string(),
  value: z.string()
});

export const mcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  env: z.array(envVariableSchema),
  name: z.string()
});

// Permission-related schemas
export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always'])
});

export const toolCallUpdateSchema = z.object({
  toolCallId: z.string(),
  title: z.string().optional().nullable(),
  status: toolCallStatusSchema.optional().nullable(),
  kind: toolKindSchema.optional().nullable(),
  content: z.array(toolCallContentSchema).optional().nullable(),
  locations: z.array(toolCallLocationSchema).optional().nullable(),
  rawInput: z.record(z.unknown()).optional(),
  rawOutput: z.record(z.unknown()).optional()
});

// Request/response validation schemas
export const initializeRequestSchema = z.object({
  protocolVersion: z.number(),
  clientCapabilities: clientCapabilitiesSchema.optional()
});

export const initializeResponseSchema = z.object({
  protocolVersion: z.number(),
  agentCapabilities: agentCapabilitiesSchema.optional(),
  authMethods: z.array(authMethodSchema).optional()
});

// Authentication schemas
export const authenticateRequestSchema = z.object({
  methodId: z.string()
});

export const authenticateResponseSchema = z.null();

export const newSessionRequestSchema = z.object({
  cwd: z.string(),
  mcpServers: z.array(mcpServerSchema)
});

// Load session schemas
export const loadSessionRequestSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  mcpServers: z.array(mcpServerSchema)
});

export const loadSessionResponseSchema = z.null();

export const newSessionResponseSchema = z.object({
  sessionId: z.string()
});

export const promptRequestSchema = z.object({
  sessionId: z.string(),
  prompt: z.array(contentBlockSchema)
});

export const promptResponseSchema = z.object({
  stopReason: z.enum(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'])
});

export const cancelNotificationSchema = z.object({
  sessionId: z.string()
});

export const requestPermissionRequestSchema = z.object({
  sessionId: z.string(),
  toolCall: toolCallUpdateSchema,
  options: z.array(permissionOptionSchema)
});

export const requestPermissionResponseSchema = z.object({
  outcome: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('cancelled')
    }),
    z.object({
      outcome: z.literal('selected'),
      optionId: z.string()
    })
  ])
});

export const readTextFileRequestSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  line: z.number().optional().nullable(),
  limit: z.number().optional().nullable()
});

export const readTextFileResponseSchema = z.object({
  content: z.string()
});

export const writeTextFileRequestSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  content: z.string()
});

export const writeTextFileResponseSchema = z.null();

// Session notification wrapper schema
export const sessionNotificationSchema = z.object({
  sessionId: z.string(),
  update: sessionUpdateSchema
});

// Export all type definitions
export type Role = z.infer<typeof roleSchema>;
export type ToolKind = z.infer<typeof toolKindSchema>;
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;
export type TextResourceContents = z.infer<typeof textResourceContentsSchema>;
export type BlobResourceContents = z.infer<typeof blobResourceContentsSchema>;
export type EmbeddedResourceResource = z.infer<typeof embeddedResourceResourceSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type Annotations = z.infer<typeof annotationsSchema>;
export type ToolCallContent = z.infer<typeof toolCallContentSchema>;
export type ToolCallLocation = z.infer<typeof toolCallLocationSchema>;
export type PlanEntry = z.infer<typeof planEntrySchema>;
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;
export type FileSystemCapability = z.infer<typeof fileSystemCapabilitySchema>;
export type ClientCapabilities = z.infer<typeof clientCapabilitiesSchema>;
export type PromptCapabilities = z.infer<typeof promptCapabilitiesSchema>;
export type AuthMethod = z.infer<typeof authMethodSchema>;
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;
export type EnvVariable = z.infer<typeof envVariableSchema>;
export type McpServer = z.infer<typeof mcpServerSchema>;
export type PermissionOption = z.infer<typeof permissionOptionSchema>;
export type ToolCallUpdate = z.infer<typeof toolCallUpdateSchema>;
export type InitializeRequest = z.infer<typeof initializeRequestSchema>;
export type InitializeResponse = z.infer<typeof initializeResponseSchema>;
export type AuthenticateRequest = z.infer<typeof authenticateRequestSchema>;
export type AuthenticateResponse = z.infer<typeof authenticateResponseSchema>;
export type NewSessionRequest = z.infer<typeof newSessionRequestSchema>;
export type NewSessionResponse = z.infer<typeof newSessionResponseSchema>;
export type LoadSessionRequest = z.infer<typeof loadSessionRequestSchema>;
export type LoadSessionResponse = z.infer<typeof loadSessionResponseSchema>;
export type PromptRequest = z.infer<typeof promptRequestSchema>;
export type PromptResponse = z.infer<typeof promptResponseSchema>;
export type CancelNotification = z.infer<typeof cancelNotificationSchema>;
export type RequestPermissionRequest = z.infer<typeof requestPermissionRequestSchema>;
export type RequestPermissionResponse = z.infer<typeof requestPermissionResponseSchema>;
export type ReadTextFileRequest = z.infer<typeof readTextFileRequestSchema>;
export type ReadTextFileResponse = z.infer<typeof readTextFileResponseSchema>;
export type WriteTextFileRequest = z.infer<typeof writeTextFileRequestSchema>;
export type WriteTextFileResponse = z.infer<typeof writeTextFileResponseSchema>;
export type SessionNotification = z.infer<typeof sessionNotificationSchema>;