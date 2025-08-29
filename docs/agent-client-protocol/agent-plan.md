# Agent Plan

> How Agents communicate their execution plans

Plans are execution strategies for complex tasks that require multiple steps.

Agents may share plans with Clients through [`session/update`](./prompt-turn#3-agent-reports-output) notifications, providing real-time visibility into their thinking and progress.

## Creating Plans

When the language model creates an execution plan, the Agent **SHOULD** report it to the Client:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "plan",
      "entries": [
        {
          "content": "Analyze the existing codebase structure",
          "priority": "high",
          "status": "pending"
        },
        {
          "content": "Identify components that need refactoring",
          "priority": "high",
          "status": "pending"
        },
        {
          "content": "Create unit tests for critical functions",
          "priority": "medium",
          "status": "pending"
        }
      ]
    }
  }
}
```

<ParamField path="entries" type="PlanEntry[]" required>
  An array of [plan entries](#plan-entries) representing the tasks to be
  accomplished
</ParamField>

## Plan Entries

Each plan entry represents a specific task or goal within the overall execution strategy:

<ParamField path="content" type="string" required>
  A human-readable description of what this task aims to accomplish
</ParamField>

<ParamField path="priority" type="PlanEntryPriority" required>
  The relative importance of this task.

  * `high`
  * `medium`
  * `low`
</ParamField>

<ParamField path="status" type="PlanEntryStatus" required>
  The current [execution status](#status) of this task

  * `pending`
  * `in_progress`
  * `completed`
</ParamField>

## Updating Plans

As the Agent progresses through the plan, it **SHOULD** report updates by sending more `session/update` notifications with the same structure.

The Agent **MUST** send a complete list of all plan entries in each update and their current status. The Client **MUST** replace the current plan completely.

### Dynamic Planning

Plans can evolve during execution. The Agent **MAY** add, remove, or modify plan entries as it discovers new requirements or completes tasks, allowing it to adapt based on what it learns.
