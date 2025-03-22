/**
 * Timer Trigger Tool
 * Triggers a workflow after a specified delay or at a specific time
 */
export async function execute(params, inputData) {
  try {
    // Validate parameters
    if (!params.triggerType) {
      return { error: "triggerType parameter is required (delay or scheduled)" };
    }

    const triggerType = params.triggerType.toLowerCase();
    const now = new Date();
    let triggerTime;
    let delayMs;

    // Handle delay-based trigger
    if (triggerType === 'delay') {
      if (!params.delaySeconds && !params.delayMinutes && !params.delayHours) {
        return { error: "For delay trigger, at least one of delaySeconds, delayMinutes, or delayHours is required" };
      }

      // Calculate total delay in milliseconds
      delayMs = 0;
      if (params.delaySeconds) delayMs += parseInt(params.delaySeconds, 10) * 1000;
      if (params.delayMinutes) delayMs += parseInt(params.delayMinutes, 10) * 60 * 1000;
      if (params.delayHours) delayMs += parseInt(params.delayHours, 10) * 60 * 60 * 1000;

      triggerTime = new Date(now.getTime() + delayMs);
    } 
    // Handle scheduled time-based trigger
    else if (triggerType === 'scheduled') {
      if (!params.scheduledTime) {
        return { error: "For scheduled trigger, scheduledTime parameter is required (ISO string or timestamp)" };
      }

      // Parse the scheduled time
      try {
        triggerTime = new Date(params.scheduledTime);
        if (isNaN(triggerTime.getTime())) {
          return { error: "Invalid scheduledTime format. Use ISO string (YYYY-MM-DDTHH:MM:SS) or timestamp" };
        }
      } catch (error) {
        return { error: `Failed to parse scheduledTime: ${error.message}` };
      }

      // Calculate delay in milliseconds
      delayMs = triggerTime.getTime() - now.getTime();
      
      // Check if the scheduled time is in the past
      if (delayMs < 0) {
        if (params.allowPastTriggers === 'true') {
          // If past triggers are allowed, trigger immediately
          delayMs = 0;
          triggerTime = new Date();
        } else {
          return { error: "Scheduled time is in the past" };
        }
      }
    } else {
      return { error: "Invalid triggerType. Use 'delay' or 'scheduled'" };
    }

    // Check if we should simulate the delay (for testing purposes)
    const simulateOnly = params.simulateOnly === 'true';
    
    if (simulateOnly) {
      // For simulation, return immediately
      return {
        triggered: true,
        triggerType: triggerType,
        scheduledTime: triggerTime.toISOString(),
        delayMs: delayMs,
        timestamp: now.toISOString(),
        simulated: true,
        message: `Timer trigger SIMULATED to fire ${triggerType === 'delay' ? 'after ' + formatDelay(delayMs) : 'at ' + triggerTime.toLocaleString()}`
      };
    }
    
    // For actual delay, use a Promise with setTimeout
    console.log(`Timer trigger waiting ${formatDelay(delayMs)}...`);
    
    // Use a shorter delay for demonstration purposes if requested
    if (params.accelerateTime === 'true') {
      // Accelerate time by using 1 second to represent 1 minute
      delayMs = Math.min(10000, Math.ceil(delayMs / 60));
      console.log(`Time acceleration enabled. Using ${delayMs}ms instead of actual delay.`);
    }
    
    // Cap the maximum delay to 30 seconds for practical purposes
    const actualDelayMs = Math.min(30000, delayMs);
    if (actualDelayMs < delayMs) {
      console.log(`Delay capped at 30 seconds for practical purposes (original: ${formatDelay(delayMs)})`);
    }
    
    // Wait for the specified time
    await new Promise(resolve => setTimeout(resolve, actualDelayMs));
    
    // After waiting, return the result
    const completedTime = new Date();
    return {
      triggered: true,
      triggerType: triggerType,
      scheduledTime: triggerTime.toISOString(),
      delayMs: delayMs,
      actualDelayMs: actualDelayMs,
      startTimestamp: now.toISOString(),
      completedTimestamp: completedTime.toISOString(),
      message: `Timer trigger fired ${triggerType === 'delay' ? 'after waiting ' + formatDelay(actualDelayMs) : 'at ' + completedTime.toLocaleString()}`
    };
  } catch (error) {
    return { 
      error: error.message || 'Unknown error occurred',
      triggered: false
    };
  }
}

/**
 * Format delay in milliseconds to a human-readable string
 */
function formatDelay(ms) {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  
  return parts.join(', ');
}
