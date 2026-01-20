import { createPlayer } from './player.js';
import { createPlatform } from './platform.js';
import {
  PLAYER_RADIUS,
  PLAYER_START_X,
  PLATFORM_WIDTH,
  PLATFORM_HEIGHT,
  GROUND_HEIGHT,
  getPlatformDifficulty,
  PLATFORM_MAX_WIDTH,
  PLATFORM_MAX_STEP_Y
} from '../config.js';

let height = 0;
let highestPlatformY;
let xp = 0; // XP for platform bounces
let highestPlatformHit = null; // Track the highest platform the player has landed on

export function getHeight() {
  // Height is the height above ground of the highest platform hit (rounded)
  if (highestPlatformHit && typeof highestPlatformHit === 'object') {
    // Assume ground is at canvas.height, so height = groundY - platformY
    return Math.round(highestPlatformHit.groundY - highestPlatformHit.y);
  }
  return 0;
}

export function getXP() {
  return xp;
}

export function getHighestPlatformY() {
  return highestPlatformY;
}

export function setHighestPlatformY(y) {
  highestPlatformY = y;
}

export function incrementXP() {
  xp++;
}

export function setXP(val) {
  xp = Math.max(0, val);
}

export function spawnPlatformAbove(world, canvas) {
  const { width, stepY } = getPlatformDifficulty(height);
  const x = Math.random() * (canvas.width - width - 80) + 40;
  const y = highestPlatformY - stepY;
  const angle = (Math.random() - 0.5) * 2 * Math.PI / 6;
  world.addEntity(createPlatform(x, y, width, PLATFORM_HEIGHT, angle));
  highestPlatformY = y;
  height++;
}

export function computeHighestPlatformY(world, canvas) {
  let minY = canvas.height;
  world.entities.forEach(e => {
    if (e.components && e.components.PlatformComponent) {
      const y = e.components.PositionComponent.y;
      if (y < minY) minY = y;
    }
  });
  return minY;
}

export function initWorld(world, canvas) {
  // Start player so their feet are at the ground
  const player = createPlayer(PLAYER_START_X, canvas.height - GROUND_HEIGHT - PLAYER_RADIUS);
  world.addEntity(player);

  // Add a few initial platforms at easy settings
  const numInitialPlatforms = 5;
  for (let i = 0; i < numInitialPlatforms; i++) {
    const y = canvas.height - 40 - i * PLATFORM_MAX_STEP_Y;
    const x = Math.random() * (canvas.width - PLATFORM_MAX_WIDTH - 80) + 40;
    const angle = (Math.random() - 0.5) * 2 * Math.PI / 6;
    world.addEntity(createPlatform(x, y, PLATFORM_MAX_WIDTH, PLATFORM_HEIGHT, angle));
  }
  // Add ground platform (flat)
  world.addEntity(createPlatform(0, canvas.height - GROUND_HEIGHT, canvas.width, GROUND_HEIGHT, 0));
  highestPlatformY = computeHighestPlatformY(world, canvas);
}

export function setHighestPlatformHit(platform) {
  if (!highestPlatformHit || platform.y < highestPlatformHit.y) {
    highestPlatformHit = platform;
  }
} 