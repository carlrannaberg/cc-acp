#!/usr/bin/env node

// Entry point for Claude Code ACP Agent
console.log('Claude Code ACP Agent starting...');

export * from './bridge/agent';
export * from './protocol/connection';
export * from './protocol/schemas';