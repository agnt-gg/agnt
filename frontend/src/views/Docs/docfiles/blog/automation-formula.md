# Automation Formula Implementation

This document provides both Python and JavaScript implementations of the automation formula discussed in the blog post. The formula calculates the breakeven time for task automation.

## Formula

The breakeven time for task automation can be calculated using the following formula:

```mathjax
$$ T_{be} = \frac{T_a}{(T_m - T_r) \times F} $$

Where:

- $T_{be}$ = Breakeven time (in days)
- $T_a$ = Time required to automate the task (in hours)
- $T_m$ = Time required for manual task execution (in hours)
- $T_r$ = Time required to run the automated task (in hours)
- $F$ = Frequency of task execution (per day)
```

## Python Implementation

Here's the Python code that implements this formula:

```python
import math

def calculate_breakeven_time(Ta: float, Tm: float, Tr: float, F: float) -> float:
    if F == 0 or Tm <= Tr:
        return float('inf')  # It will never break even if frequency is 0 or if automated time >= manual time
    
    Tbe = Ta / ((Tm - Tr) * F)
    return round(Tbe, 2)  # Round to 2 decimal places

def format_breakeven_time(days: float) -> str:
    if math.isinf(days):
        return "Never"
    
    if days < 1:
        hours = round(days * 24)
        return f"{hours} hour{'s' if hours != 1 else ''}"
    
    if days < 30:
        days = round(days)
        return f"{days} day{'s' if days != 1 else ''}"
    
    months = round(days / 30)
    return f"{months} month{'s' if months != 1 else ''}"

def get_formatted_breakeven_time(Ta: float, Tm: float, Tr: float, F: float) -> str:
    breakeven_days = calculate_breakeven_time(Ta, Tm, Tr, F)
    return format_breakeven_time(breakeven_days)

# Example usage
Ta = 10  # Time to automate: 10 hours
Tm = 1   # Manual execution time: 1 hour
Tr = 0.1 # Automated execution time: 0.1 hours
F = 1    # Frequency: Once per day

result = get_formatted_breakeven_time(Ta, Tm, Tr, F)
print(f"Breakeven time: {result}")
```

## JavaScript Implementation

Here's the JavaScript code that implements this formula:

```javascript
/**
 * Calculate the breakeven time for task automation
 * @param {number} Ta - Time required to automate the task (in hours)
 * @param {number} Tm - Time required for manual task execution (in hours)
 * @param {number} Tr - Time required to run the automated task (in hours)
 * @param {number} F - Frequency of task execution (per day)
 * @returns {number} Breakeven time in days
 */
export function calculateBreakevenTime(Ta, Tm, Tr, F) {
  // Ensure we don't divide by zero
  if (F === 0 || Tm <= Tr) {
    return Infinity; // It will never break even if frequency is 0 or if automated time >= manual time
  }

  const Tbe = Ta / ((Tm - Tr) * F);
  return Math.round(Tbe * 100) / 100; // Round to 2 decimal places
}

/**
 * Format the result into a human-readable string
 * @param {number} days - Number of days
 * @returns {string} Formatted time string
 */
export function formatBreakevenTime(days) {
  if (days === Infinity) {
    return "Never";
  }

  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  if (days < 30) {
    return `${Math.round(days)} day${days !== 1 ? 's' : ''}`;
  }

  const months = Math.round(days / 30);
  return `${months} month${months !== 1 ? 's' : ''}`;
}

/**
 * Calculate and format the breakeven time
 * @param {number} Ta - Time required to automate the task (in hours)
 * @param {number} Tm - Time required for manual task execution (in hours)
 * @param {number} Tr - Time required to run the automated task (in hours)
 * @param {number} F - Frequency of task execution (per day)
 * @returns {string} Formatted breakeven time
 */
export function getFormattedBreakevenTime(Ta, Tm, Tr, F) {
  const breakevenDays = calculateBreakevenTime(Ta, Tm, Tr, F);
  return formatBreakevenTime(breakevenDays);
}
```

Both implementations provide three main functions:

1. `calculate_breakeven_time` / `calculateBreakevenTime`: Implements the formula and returns the result in days.
2. `format_breakeven_time` / `formatBreakevenTime`: Formats the number of days into a human-readable string.
3. `get_formatted_breakeven_time` / `getFormattedBreakevenTime`: Combines the above two functions for ease of use.

You can use these functions to calculate the breakeven time for task automation in your projects, regardless of whether you're using Python or JavaScript.