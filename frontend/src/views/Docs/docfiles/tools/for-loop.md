# For Loop 🔁

## Id

`for-loop`

## Description

Executes a series of actions repeatedly based on a specified loop condition. Supports both range-based loops (e.g., 0 to 10) and list-based loops (e.g., iterating over an array of items). Each iteration can access loop-specific data like the current value and index.

## Tags

loop, iteration, control, workflow, repetition

## Input Parameters

### Required

- **loopType** (string): The type of loop to execute (`Range` or `List`)
- **actions** (string): Comma-separated list of action names to execute in each iteration

### Optional

- **start** (number) [Range loop type operations only]: The starting value for range-based loops
- **end** (number) [Range loop type operations only]: The ending value for range-based loops
- **step** (number, default=1) [Range loop type operations only]: The increment step for range-based loops
- **list** (string) [List loop type operations only]: The list of items to iterate over for list-based loops (JSON array or comma-separated values)
- **initialValue** (number, default=0): The initial value for the currentIteration counter

## Output Format

- **iterations** (number): The total number of iterations in the loop
- **currentIteration** (number): The current iteration number (0-indexed)
- **results** (array): Array of results from each iteration, containing the results of all actions executed in that iteration
- **success** (boolean): Indicates whether the loop execution was successful
- **error** (string|null): Error message if the loop execution failed
