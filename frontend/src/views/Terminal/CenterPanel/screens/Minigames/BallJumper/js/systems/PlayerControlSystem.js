import { System } from '../core/System.js';
import { PLAYER_SPEED_BOOST } from '../config.js';
import { getXP, setXP } from '../entities/initWorld.js';

const MOVE_SPEED = 4;
const JUMP_STRENGTH = 17;
const ACCEL = 1.2;
const MAX_SPEED = 8;
const JUMP_BUFFER_TIME = 120; // ms, tweak as desired

export class PlayerControlSystem extends System {
  constructor() {
    super(["PlayerControlComponent", "VelocityComponent", "PhysicsComponent"]);
    this.keys = {};
    window.addEventListener('keydown', e => this.keys[e.code] = true);
    window.addEventListener('keyup', e => this.keys[e.code] = false);
  }
  run(entity) {
    const control = entity.components.PlayerControlComponent;
    const velocity = entity.components.VelocityComponent;
    const physics = entity.components.PhysicsComponent;

    // Update control state
    control.left = !!(this.keys["ArrowLeft"] || this.keys["KeyA"]);
    control.right = !!(this.keys["ArrowRight"] || this.keys["KeyD"]);
    control.jump = !!(this.keys["Space"] || this.keys["ArrowUp"] || this.keys["KeyW"]);

    // Ensure helper flag exists
    if (control._lastUpPressed === undefined) control._lastUpPressed = false;

    const now = performance.now();
    const upPressed = (this.keys["ArrowUp"] || this.keys["KeyW"]);

    // --- Jump buffer: record last jump press time ---
    if (control.jump) {
      control._lastJumpPressTime = now;
    }
    const jumpBuffered = control._lastJumpPressTime && (now - control._lastJumpPressTime < JUMP_BUFFER_TIME);

    if (upPressed) {
      if (!control._lastUpPressed) {
        // Key was just pressed
        control.upPressTimestamps.push(now);
        // Keep only last 2 presses
        if (control.upPressTimestamps.length > 2) control.upPressTimestamps.shift();
        // Detect double-tap within 350ms and XP >= 50
        if (
          control.upPressTimestamps.length === 2 &&
          control.upPressTimestamps[1] - control.upPressTimestamps[0] < 350 &&
          getXP() >= 50
        ) {
          control.isUpDash = true;
        }
      }
      control._lastUpPressed = true;
    } else {
      control._lastUpPressed = false;
      // Do not clear timestamps to allow double-tap detection across releases
      if (!control.isUpDash) {
        // Only clear if not currently dashing to prevent false triggers
        if (control.upPressTimestamps.length > 2) control.upPressTimestamps.shift();
      }
      if (control.isUpDash) {
        // If dash was active but key released, stop dash
        control.isUpDash = false;
      }
    }

    // --- Up-dash effect ---
    if (control.isUpDash && upPressed && getXP() > 0) {
      velocity.dy = -18; // strong upward dash
      setXP(getXP() - 1); // deplete XP rapidly (1 per frame)
      if (getXP() <= 0) control.isUpDash = false;
    }

    // Horizontal movement
    if (control.left) {
      // Accelerate left
      velocity.dx -= ACCEL;
      if (velocity.dx < -MAX_SPEED) velocity.dx = -MAX_SPEED;
    } else if (control.right) {
      // Accelerate right
      velocity.dx += ACCEL;
      if (velocity.dx > MAX_SPEED) velocity.dx = MAX_SPEED;
    }

    // Jumping (with buffer)
    if ((control.jump || jumpBuffered) && physics.grounded && control.canJump) {
      // If already moving up, apply boost
      if (velocity.dy < 0) velocity.dy = -JUMP_STRENGTH * PLAYER_SPEED_BOOST;
      else velocity.dy = -JUMP_STRENGTH;
      physics.grounded = false;
      control.canJump = false;
      control._lastJumpPressTime = null; // clear buffer after jump
    }
    if (!control.jump) {
      control.canJump = true;
    }
  }
} 