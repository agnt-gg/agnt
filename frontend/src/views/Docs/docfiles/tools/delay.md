# Delay ⏱️

## Id

`delay`

## Description

Introduces a controlled pause in workflow execution for a specified duration. Supports multiple time units including milliseconds, seconds, minutes, and hours for flexible timing control.

## Tags

delay, timing, pause, wait, utility

## Input Parameters

### Required

- **duration** (number): The amount of time to wait
- **unit** (string): The time unit for the duration (`milliseconds`, `seconds`, `minutes`, `hours`)

## Output Format

- **delayedUntil** (string): ISO timestamp indicating when the delay period will complete
