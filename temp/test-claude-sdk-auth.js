#!/usr/bin/env node

/* eslint-env node */
/* eslint-disable no-console */

/**
 * Test script to validate Claude Code SDK authentication behavior
 * This tests what happens when we call the SDK without an API key
 */

async function testClaudeSDKAuth() {
  console.log('Testing Claude Code SDK authentication behavior...\n');
  
  // Test 1: Without any API key or environment variables
  console.log('=== Test 1: No authentication credentials ===');
  delete process.env.CLAUDE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  
  try {
    const { query } = require('@anthropic-ai/claude-code');
    console.log('SDK imported successfully');
    
    console.log('Attempting to make a simple query...');
    const response = query({
      prompt: "Hello, can you respond with just 'test successful'?",
      options: {
        maxTurns: 1,
        allowedTools: []
      }
    });
    
    // Try to get first response
    const iterator = response[Symbol.asyncIterator]();
    const firstResult = await iterator.next();
    
    if (firstResult.done) {
      console.log('No response received - authentication may have failed');
    } else {
      console.log('Response received:', firstResult.value);
      console.log('✅ Claude Code SDK works without explicit API key!');
    }
    
  } catch (error) {
    console.log('❌ Error without API key:', error.message);
    
    if (error.message.includes('auth') || error.message.includes('API key') || error.message.includes('401')) {
      console.log('This appears to be an authentication error');
    }
  }
  
  console.log('\n=== Test 2: With CLAUDE_API_KEY environment variable ===');
  
  // Test 2: With API key
  process.env.CLAUDE_API_KEY = 'test-key-that-wont-work';
  
  try {
    const { query } = require('@anthropic-ai/claude-code');
    
    console.log('Attempting query with test API key...');
    const response = query({
      prompt: "Hello, can you respond with just 'test successful'?",
      options: {
        maxTurns: 1,
        allowedTools: []
      }
    });
    
    const iterator = response[Symbol.asyncIterator]();
    const firstResult = await iterator.next();
    
    if (firstResult.done) {
      console.log('No response received with API key');
    } else {
      console.log('Response received with API key:', firstResult.value);
    }
    
  } catch (error) {
    console.log('❌ Error with test API key:', error.message);
  }
  
  console.log('\n=== Summary ===');
  console.log('This test validates assumptions about Claude Code SDK authentication.');
  console.log('If Test 1 works, the SDK can use subscription auth without API key.');
  console.log('If Test 1 fails but shows auth errors, API key is required.');
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Run the test
testClaudeSDKAuth().catch(console.error);