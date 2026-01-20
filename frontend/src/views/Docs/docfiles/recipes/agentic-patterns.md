# Explore Common Agentic Patterns

This guide explores common patterns you can use as building blocks for your own workflows. Understanding these patterns will help you design more effective and maintainable automations.

## Simple Agent

The simple agent pattern is a basic pattern where an agent is created and executed in a single step. This pattern is useful for simple tasks that don't require any additional steps or complex logic.

![Simple Agent](/images/patterns/recipe-simple-agent.png)

## Prompt Chain

Prompt chaining involves connecting multiple prompts in sequence, where the output of one prompt becomes the input for the next. This pattern is useful for breaking down complex tasks into smaller, manageable steps.

![Prompt Chaining](/images/patterns/recipe-prompt-chaining.png)

## Conditional Execution

Conditional execution allows an agent to execute a task only if a certain condition is met. This pattern is useful for ensuring that an agent only performs a task when it is necessary.

![Conditional Execution](/images/patterns/recipe-conditional.png)

## Routing

An expansion on the conditional execution pattern, routing involves directing inputs to specific agents based on certain criteria. This pattern helps in efficiently handling diverse tasks by sending them to specialized agents.

![Routing](/images/patterns/recipe-routing.png)

## Aggregation

The aggregation pattern is a way to combine multiple inputs into a single output. This pattern is useful for when a step needs to combine multiple inputs into a single output.

![Aggregation](/images/patterns/recipe-aggregation.png)

## Looping

The looping pattern is a way to create a loop in a workflow. This pattern is useful for when a step needs to be repeated until certain conditions are met.

**DANGER:** Be careful with this pattern. It can easily create an infinite loop!

![Looping](/images/patterns/recipe-agent-critic.png)


**PRO TIP:** Use the looping pattern in combination with the prompt chaining and conditional execution patterns to create the "Agent Critic" pattern. This pattern allows the agent to review its own output and improve on it recursively. 
