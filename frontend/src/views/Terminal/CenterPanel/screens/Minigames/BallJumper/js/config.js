export const PLAYER_RADIUS = 24;
export const PLAYER_START_X = 48;
export const PLAYER_COLOR = '#12e0ff';
export const PLATFORM_COLOR = '#e53d8f';
export const PLATFORM_WIDTH = 240;
export const PLATFORM_HEIGHT = 10;
export const PLATFORM_STEP_Y = 80;
export const PLATFORM_STEP_X = 80;
export const GROUND_HEIGHT = 24;
export const PLATFORM_MAX_SLANT_DEG = 35; // maximum slant in degrees
export const PLATFORM_MAX_SLANT_RAD = PLATFORM_MAX_SLANT_DEG * Math.PI / 180;
export const PLATFORM_SLIDE_MULTIPLIER = 1.5;
export const PLAYER_SPEED_BOOST = 1.5; // Multiplier for speed boost when moving in same direction 
export const PLATFORM_MIN_WIDTH = 80;
export const PLATFORM_MAX_WIDTH = 240;
export const PLATFORM_MIN_STEP_Y = 120;
export const PLATFORM_MAX_STEP_Y = 80;
export const PLATFORM_BOUNCE_VELOCITY = 6; // Upward velocity applied when landing, for a slight bounce
export const PLATFORM_BOUNCE_MULTIPLIER = 0.6; // Fraction of downward speed returned upward as bounce
export const PLATFORM_MAX_BOUNCE_VELOCITY = 26; // Cap the maximum upward bounce speed

// Returns width and stepY based on height (was score)
export function getPlatformDifficulty(height) {
  // Clamp t between 0 (easy) and 1 (hard)
  const t = Math.min(height / 30, 1); // Adjust 30 for how quickly it gets hard
  const width = PLATFORM_MAX_WIDTH - t * (PLATFORM_MAX_WIDTH - PLATFORM_MIN_WIDTH);
  const stepY = PLATFORM_MAX_STEP_Y + t * (PLATFORM_MIN_STEP_Y - PLATFORM_MAX_STEP_Y);
  return { width, stepY };
} 