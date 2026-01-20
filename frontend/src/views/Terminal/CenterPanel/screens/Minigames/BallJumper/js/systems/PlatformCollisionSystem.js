import { System } from '../core/System.js';
import { PLATFORM_SLIDE_MULTIPLIER, PLATFORM_BOUNCE_VELOCITY, PLATFORM_BOUNCE_MULTIPLIER, PLATFORM_MAX_BOUNCE_VELOCITY } from '../config.js';
import { playBounceSound } from '../utils/audio.js';
import { incrementXP, getXP, setHighestPlatformHit } from '../entities/initWorld.js';

export class PlatformCollisionSystem extends System {
  constructor() {
    super(["PositionComponent", "VelocityComponent", "PhysicsComponent"]);
  }
  run(entity, world) {
    const pos = entity.components.PositionComponent;
    const vel = entity.components.VelocityComponent;
    const phys = entity.components.PhysicsComponent;
    // Compute the player's previous position (after PhysicsSystem has already updated current pos)
    // This allows us to detect if the player has passed through a platform between frames
    const prevPosX = pos.x - vel.dx;
    const prevPosY = pos.y - vel.dy;
    let grounded = false;
    world.entities.forEach(e => {
      if (e.components.PlatformComponent) {
        const plat = e.components.PlatformComponent;
        const ppos = e.components.PositionComponent;
        const angle = plat.angle || 0;
        // Transform player CURRENT bottom position into platform's local (rotated) space
        const cx = ppos.x + plat.width / 2;
        const cy = ppos.y + plat.height / 2;
        const px = pos.x - cx;
        const py = pos.y + 24 - cy; // bottom of player
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        const localX = px * cos - py * sin;
        const localY = px * sin + py * cos;

        // Transform player PREVIOUS bottom position into the same local space
        const prevPx = prevPosX - cx;
        const prevPy = prevPosY + 24 - cy;
        const prevLocalX = prevPx * cos - prevPy * sin;
        const prevLocalY = prevPx * sin + prevPy * cos;
        const edgeBuffer = 4; // or whatever value feels right
        const withinXNow = localX > -plat.width / 2 - edgeBuffer && localX < plat.width / 2 + edgeBuffer;
        const withinXPrev = prevLocalX > -plat.width / 2 - edgeBuffer && prevLocalX < plat.width / 2 + edgeBuffer;
        const onTopNow = localY > -plat.height / 2 && localY < plat.height / 2;

        // Collision if currently intersecting OR we crossed the platform between frames (tunnelling)
        const crossedThrough =
          withinXPrev && withinXNow && // stayed horizontally within platform
          prevLocalY <= -plat.height / 2 && // was above the top surface last frame
          localY >= -plat.height / 2; // and is now at/under it

        if ((withinXNow && onTopNow || crossedThrough) && vel.dy >= 0) {
          // Play landing sound and mark highlight when first touching a new platform
          if (entity._currentPlatformId !== e.id) {
            incrementXP();
            playBounceSound(ppos.y);
            plat.bounceHighlightTime = performance.now();
            // Set highestPlatformHit if this is the highest (lowest y) platform hit so far
            if (typeof window !== 'undefined' && window.innerHeight) {
              setHighestPlatformHit({
                y: ppos.y,
                groundY: window.innerHeight
              });
            }
          }
          // Place player on top of the platform (in world space)
          const surfaceY = -plat.height / 2;
          // Convert back to world space
          const wx = localX * cos + surfaceY * sin + cx;
          const wy = -localX * sin + surfaceY * cos + cy - 24;
          pos.x = wx;
          pos.y = wy;
          // Bounce strength scales with the speed at which the player was falling
          const incomingSpeed = vel.dy; // positive downward
          let bounceSpeed = Math.max(
            PLATFORM_BOUNCE_VELOCITY,
            incomingSpeed * PLATFORM_BOUNCE_MULTIPLIER
          );
          // 5% bounce boost if XP > 50
          if (getXP() > 50) {
            bounceSpeed *= 1.05;
          }
          // Clamp to avoid extreme bounces
          if (bounceSpeed > PLATFORM_MAX_BOUNCE_VELOCITY) {
            bounceSpeed = PLATFORM_MAX_BOUNCE_VELOCITY;
          }
          // Apply impulse along the platform's outward normal so bounce direction depends on slant
          const normalX = Math.sin(angle);   // horizontal direction corrected
          const normalY = -Math.cos(angle);  // upward component remains the same
          vel.dx += bounceSpeed * normalX;
          vel.dy = bounceSpeed * normalY;
          phys.grounded = true;
          // Slide: add velocity along the platform's slope
          vel.dx += Math.sin(angle) * PLATFORM_SLIDE_MULTIPLIER;
          grounded = true;
          entity.lastPlatformAngle = angle;
          entity._currentPlatformId = e.id;
        }
      }
    });
    if (!grounded) {
      entity.lastPlatformAngle = undefined;
      entity._currentPlatformId = undefined;
    }
  }
} 