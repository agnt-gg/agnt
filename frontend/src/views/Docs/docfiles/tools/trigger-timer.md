# Timer Trigger ⏰

## Id

`timer-trigger`

## Description

This trigger node fires the workflow at specified intervals or at a specific time. Supports flexible scheduling options including immediate execution on start, interval-based scheduling, and specific time scheduling with day selection.

## Tags

timer, trigger, scheduling, interval, cron, automation

## Input Parameters

### Required

- **fireOnStart** (string, default='Yes'): Fire the trigger immediately when the workflow starts
- **scheduleType** (string, default='Interval'): Choose between interval-based or specific time scheduling

### Optional

- **schedule** (string, default='Every Minute') [Interval operations only]: Select the interval for the timer (Every Minute, Every 5 Minutes, Every 15 Minutes, Every 30 Minutes, Hourly, Daily, Weekly, Monthly)
- **specificTime** (string) [Specific Time operations only]: Select the specific time to run the trigger
- **specificDays** (array) [Specific Time operations only]: Select the days to run the trigger at the specific time (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday)

## Output Format

- **timestamp** (string): The timestamp when the trigger fired
