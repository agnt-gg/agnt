# Workflow Execution Credit System

## Overview

Our workflow execution system uses AGNT tokens to measure and track resource usage. AGNT tokens are calculated based on the execution time of each node within a workflow.

## Credit Calculation

- **Base Rate**: 1 second of execution time = 1 AGNT token = $0.01
- **Conversion**: Simple 1:1:0.01 ratio (time:AGNT:USD)

## How to Read Credit Usage

To understand the cost and duration from AGNT tokens used:

1. AGNT tokens directly correspond to seconds of execution time
2. Multiply AGNT tokens by $0.01 to get the cost in USD
3. Example: 14 AGNT = 14 seconds of execution time = $0.14

## Time to AGNT to Cost Conversion Table

| Execution Time | AGNT Tokens | Cost (USD) |
|----------------|-------------|------------|
| 1 second       | 1           | $0.01      |
| 10 seconds     | 10          | $0.10      |
| 30 seconds     | 30          | $0.30      |
| 60 seconds     | 60          | $0.60      |
| 300 seconds    | 300         | $3.00      |

## Important Notes

1. AGNT tokens are calculated for each node execution individually.
2. The total workflow cost is the sum of all node execution tokens.
3. AGNT credits are measured to the thousandth decimal place (e.g., 14.374 AGNT).
4. Idle time or delays between node executions are not charged.

## Example

If a workflow execution shows 35.742 AGNT tokens used:
- This corresponds to 35.742 seconds of total execution time across all nodes
- The cost would be $0.36 (35.742 * $0.01)
- Individual node usage can be read directly in seconds from their AGNT token count

Remember, this system provides a straightforward way to measure resource usage and cost based on execution time. It allows for precise tracking, even for very short operations.