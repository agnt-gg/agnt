# Random Number

## Overview

The **Random Number** node generates a random number within a specified range. This utility is useful for creating randomized workflows, testing scenarios, or adding variability to your automation processes.

## Category

**Utility**

## Parameters

### min

- **Type**: String (numeric)
- **Required**: Yes
- **Description**: The minimum value (inclusive) for the random number generation
- **Example**: `1`, `0`, `-10`

### max

- **Type**: String (numeric)
- **Required**: Yes
- **Description**: The maximum value (inclusive) for the random number generation
- **Example**: `100`, `1000`, `50`

## Outputs

### randomNumber

- **Type**: Number
- **Description**: The generated random number within the specified range (inclusive of both min and max)

## Use Cases

1. **A/B Testing**: Randomly assign users to different test groups
2. **Game Mechanics**: Generate random values for game elements
3. **Load Testing**: Create random delays or data for testing
4. **Sampling**: Select random items from a dataset
5. **Lottery Systems**: Generate random numbers for selection processes

## Example Configuration

**Basic Random Number (1-100)**

```
min: 1
max: 100
```

**Random Percentage (0-100)**

```
min: 0
max: 100
```

**Random Delay (1-10 seconds)**

```
min: 1
max: 10
```

## Tips

- The generated number is **inclusive** of both min and max values
- Both min and max can be negative numbers
- The node generates integers, not decimal numbers
- Use the output in conditional logic or as input to other nodes
- Combine with a For Loop to generate multiple random numbers

## Common Patterns

**Random Selection**

```
1. Generate random number between 1 and N (where N is your list size)
2. Use the number to select an item from a list
```

**Random Delay**

```
1. Generate random number for seconds
2. Pass to Delay node for variable timing
```

**Probability-Based Logic**

```
1. Generate random number 1-100
2. Use conditional edges to create probability-based paths
   - If randomNumber <= 30: Path A (30% chance)
   - If randomNumber > 30: Path B (70% chance)
```

## Related Nodes

- **Counter**: For sequential number generation
- **Delay**: Often used with random numbers for variable delays
- **For Loop**: Generate multiple random numbers
- **Data Transformer**: Transform the random number output

## Tags

random, number, generator, utility, probability, testing
