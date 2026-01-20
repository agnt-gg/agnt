# Agent Chat 🤖

## Id

`agnt-agent`

## Description

Chat with an AI agent from your agent library. Select an agent and send messages to interact with it within your workflow. The agent maintains conversation history and can execute assigned tools to perform complex tasks autonomously.

## Tags

agent, chat, ai, conversation, tools, automation, workflow

## Input Parameters

### Required

- **agentId** (string): Select the agent to chat with from your agent library
- **message** (string): The message to send to the agent

### Optional

- **conversationHistory** (array): Previous conversation messages for context (automatically managed by the workflow)

## Output Format

- **success** (boolean): Whether the chat was successful
- **response** (string): The agent's response message
- **agentId** (string): The ID of the agent that responded
- **conversationId** (string): Unique conversation ID for tracking the chat session
- **toolExecutions** (array): Array of tools executed by the agent with their inputs and outputs
- **toolsUsed** (number): Number of tools used by the agent during the conversation
- **conversationHistory** (array): Updated conversation history including the new message and response
- **error** (string|null): Error message if the chat failed
