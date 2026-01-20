import { System } from '../core/System.js';
import { resetBounceScale, playBounceSound } from '../utils/audio.js';
import { PLATFORM_BOUNCE_VELOCITY, PLATFORM_BOUNCE_MULTIPLIER, PLATFORM_MAX_BOUNCE_VELOCITY } from '../config.js';

const FRICTION = 0.8;

export class PhysicsSystem extends System {
  constructor(getCanvasHeight) {
    super(["PositionComponent", "VelocityComponent", "PhysicsComponent"]);
    this.getCanvasHeight = getCanvasHeight;
  }
  run(entity) {
    const pos = entity.components.PositionComponent;
    const vel = entity.components.VelocityComponent;
    const phys = entity.components.PhysicsComponent;

    // Apply gravity
    vel.dy += phys.gravity;

    // Update position
    pos.x += vel.dx;
    pos.y += vel.dy;

    // Dynamic ground collision
    const groundY = this.getCanvasHeight() - 24; // 24 is player radius
    const touchingGround = pos.y >= groundY;
    if (touchingGround && !entity._wasOnGround) {
      // First frame hitting ground – reset musical scale and play base note
      resetBounceScale();
      playBounceSound(groundY);

      // --- Extra bounce on ground ---
      const incomingSpeed = vel.dy; // positive downward speed on impact
      // Baseline and multiplier chosen to feel more springy than platforms
      const BASE_GROUND_BOUNCE = PLATFORM_BOUNCE_VELOCITY * 1.5; // > regular platform
      const bounceMultiplier = PLATFORM_BOUNCE_MULTIPLIER + 0.3; // stronger multiplier
      let bounceSpeed = Math.max(BASE_GROUND_BOUNCE, incomingSpeed * bounceMultiplier);
      // Allow a slightly higher cap for the ground bounce
      const MAX_GROUND_BOUNCE = PLATFORM_MAX_BOUNCE_VELOCITY * 1.3;
      if (bounceSpeed > MAX_GROUND_BOUNCE) bounceSpeed = MAX_GROUND_BOUNCE;

      vel.dy = -bounceSpeed; // apply upward impulse
    }

    if (touchingGround) {
      // Ensure the player doesn't sink below ground on the same frame
      pos.y = groundY;
      // If we already applied bounce above, vel.dy will be negative; otherwise zero
      if (vel.dy > 0) vel.dy = 0;
      phys.grounded = true;
    } else {
      phys.grounded = false;
    }
    // Remember ground state for next tick
    entity._wasOnGround = touchingGround;

    // Simple horizontal bounds with bouncy walls
    const playerRadius = 24;
    const leftWall = 0;
    const rightWall = window.innerWidth;
    // Left wall bounce
    if (pos.x < leftWall + playerRadius) {
      if (vel.dx < 0) {
        // Bouncy wall logic
        const incomingSpeed = -vel.dx; // positive value
        const BASE_WALL_BOUNCE = PLATFORM_BOUNCE_VELOCITY * 1.5;
        const bounceMultiplier = PLATFORM_BOUNCE_MULTIPLIER + 0.3;
        let bounceSpeed = Math.max(BASE_WALL_BOUNCE, incomingSpeed * bounceMultiplier);
        const MAX_WALL_BOUNCE = PLATFORM_MAX_BOUNCE_VELOCITY * 1.3;
        if (bounceSpeed > MAX_WALL_BOUNCE) bounceSpeed = MAX_WALL_BOUNCE;
        vel.dx = bounceSpeed; // bounce to the right
        playBounceSound(pos.y);
        // Upward nudge and particle if up is pressed
        if (entity.id === 'player' && entity.components.PlayerControlComponent) {
          const keys = window && window.agntEcsInputKeys;
          // Fallback: check PlayerControlComponent.jump (set by PlayerControlSystem)
          const upPressed = (keys && (keys['ArrowUp'] || keys['KeyW'])) || entity.components.PlayerControlComponent.jump;
          if (upPressed && entity.components.PlayerControlComponent.wallBounceCooldown === 0) {
            // Scale boost with incoming horizontal speed
            const incomingSpeed = Math.abs(vel.dx);
            let boost = 2 + 0.12 * incomingSpeed;
            if (boost > 5) boost = 5;
            entity.components.PlayerControlComponent.wallBounceBoost = boost;
            entity.components.PlayerControlComponent.wallBounceParticleFrames = 4;
            entity.components.PlayerControlComponent.wallBounceCooldown = 16;
          }
        }
      }
      pos.x = leftWall + playerRadius;
    }
    // Right wall bounce
    if (pos.x > rightWall - playerRadius) {
      if (vel.dx > 0) {
        // Bouncy wall logic
        const incomingSpeed = vel.dx; // positive value
        const BASE_WALL_BOUNCE = PLATFORM_BOUNCE_VELOCITY * 1.5;
        const bounceMultiplier = PLATFORM_BOUNCE_MULTIPLIER + 0.3;
        let bounceSpeed = Math.max(BASE_WALL_BOUNCE, incomingSpeed * bounceMultiplier);
        const MAX_WALL_BOUNCE = PLATFORM_MAX_BOUNCE_VELOCITY * 1.3;
        if (bounceSpeed > MAX_WALL_BOUNCE) bounceSpeed = MAX_WALL_BOUNCE;
        vel.dx = -bounceSpeed; // bounce to the left
        playBounceSound(pos.y);
        // Upward nudge and particle if up is pressed
        if (entity.id === 'player' && entity.components.PlayerControlComponent) {
          const keys = window && window.agntEcsInputKeys;
          const upPressed = (keys && (keys['ArrowUp'] || keys['KeyW'])) || entity.components.PlayerControlComponent.jump;
          if (upPressed && entity.components.PlayerControlComponent.wallBounceCooldown === 0) {
            // Scale boost with incoming horizontal speed
            const incomingSpeed = Math.abs(vel.dx);
            let boost = 2 + 0.12 * incomingSpeed;
            if (boost > 5) boost = 5;
            entity.components.PlayerControlComponent.wallBounceBoost = boost;
            entity.components.PlayerControlComponent.wallBounceParticleFrames = 4;
            entity.components.PlayerControlComponent.wallBounceCooldown = 16;
          }
        }
      }
      pos.x = rightWall - playerRadius;
    }

    // Friction on ground
    if (phys.grounded) {
      // Check if standing on a flat platform
      let onFlat = false;
      if (entity.lastPlatformAngle !== undefined) {
        onFlat = Math.abs(entity.lastPlatformAngle) < 0.01;
      }
      if (onFlat) {
        vel.dx *= FRICTION;
      }
    }

    // Update player rotation for rolling effect
    if (entity.components.RenderComponent && 'rotation' in entity.components.RenderComponent) {
      const render = entity.components.RenderComponent;
      const radius = render.size;
      // dTheta = dx / r (positive for correct rolling direction)
      render.rotation += vel.dx / radius;
    }

    // Decay and apply wall bounce boost (for player only)
    if (entity.id === 'player' && entity.components.PlayerControlComponent) {
      const control = entity.components.PlayerControlComponent;
      if (control.wallBounceBoost > 0.1) {
        vel.dy -= control.wallBounceBoost;
        control.wallBounceBoost *= 0.55; // fast decay
      } else {
        control.wallBounceBoost = 0;
      }
      // Decrement cooldown and particle frames
      if (control.wallBounceCooldown > 0) control.wallBounceCooldown--;
      if (control.wallBounceParticleFrames > 0) control.wallBounceParticleFrames--;
      // Set wallBounceParticle true only if frames remain
      control.wallBounceParticle = control.wallBounceParticleFrames > 0;
    }
  }
} 