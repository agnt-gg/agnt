# Counter 🔢

## Id

`counter`

## Description

Maintains and increments a counter value that persists across workflow executions. Useful for tracking iterations, creating sequential IDs, or counting events within workflows.

## Tags

counter, utility, state, increment, tracking

## Input Parameters

### Required

- **initialValue** (number, default=0): The starting value for the counter when first initialized

### Optional

- **count** (number): Current count value from previous executions to maintain state

## Output Format

- **count** (number): The incremented counter value
