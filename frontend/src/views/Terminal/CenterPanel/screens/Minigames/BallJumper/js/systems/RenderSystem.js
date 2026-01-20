import { System } from '../core/System.js';
import { PLATFORM_COLOR } from '../config.js';
import { getXP } from '../entities/initWorld.js';

export class RenderSystem extends System {
  constructor(ctx, getCameraOffsetY) {
    super(["PositionComponent", "RenderComponent"]);
    this.ctx = ctx;
    this.getCameraOffsetY = getCameraOffsetY || (() => 0);
    this.particles = [];
  }
  run(entity) {
    const cameraOffsetY = this.getCameraOffsetY();
    if (entity.components.PlatformComponent) {
      const { x, y } = entity.components.PositionComponent;
      const renderY = y - cameraOffsetY;
      const { width, height, angle = 0 } = entity.components.PlatformComponent;
      const plat = entity.components.PlatformComponent;
      this.ctx.save();
      // Rotate around the center of the platform
      this.ctx.translate(x + width / 2, renderY + height / 2);
      this.ctx.rotate(angle);

      // --- Platform bounce up/down and bend animation ---
      let scaleX = 1, scaleY = 1, bend = 0;
      if (plat.bounceHighlightTime !== undefined) {
        const elapsed = performance.now() - plat.bounceHighlightTime;
        const BOUNCE_DURATION = 220;
        if (elapsed < BOUNCE_DURATION) {
          // Animate stretch: fast stretch, then return to normal
          // t: 0 (start) -> 1 (end)
          const t = elapsed / BOUNCE_DURATION;
          // Ease out: stretch at t=0, normal at t=1
          scaleY = 1.25 - 0.25 * t; // from 1.25 to 1
          scaleX = 0.92 + 0.08 * t; // from 0.92 to 1
          bend = (1 - t) * 18; // px, max bend at start, 0 at end
        }
      }
      this.ctx.scale(scaleX, scaleY);

      // Draw platform as a bent Bezier curve
      this.ctx.beginPath();
      // Left anchor
      this.ctx.moveTo(-width / 2, -height / 2);
      // Top curve (bend down)
      this.ctx.bezierCurveTo(
        -width / 4, -height / 2 + bend,
        width / 4, -height / 2 + bend,
        width / 2, -height / 2
      );
      // Right edge
      this.ctx.lineTo(width / 2, height / 2);
      // Bottom curve (bend up)
      this.ctx.bezierCurveTo(
        width / 4, height / 2 - bend,
        -width / 4, height / 2 - bend,
        -width / 2, height / 2
      );
      this.ctx.closePath();
      this.ctx.fillStyle = PLATFORM_COLOR;
      this.ctx.fill();

      // --- Highlight overlay if recently bounced ---
      const HIGHLIGHT_DURATION = 300; // ms
      let highlightAlpha = 0;
      if (plat.bounceHighlightTime !== undefined) {
        const elapsed = performance.now() - plat.bounceHighlightTime;
        if (elapsed < HIGHLIGHT_DURATION) {
          highlightAlpha = 1 - elapsed / HIGHLIGHT_DURATION;
        } else {
          // Clear once the highlight is done to avoid growing memory
          delete plat.bounceHighlightTime;
        }
      }

      if (highlightAlpha > 0) {
        this.ctx.save();
        this.ctx.globalAlpha = highlightAlpha;
        this.ctx.fillStyle = '#19ef83';
        this.ctx.fill();
        this.ctx.restore();
      }

      this.ctx.restore();
    } else {
      const { x, y } = entity.components.PositionComponent;
      const renderY = y - cameraOffsetY;
      const { color, size, label } = entity.components.RenderComponent;
      this.ctx.save();
      this.ctx.translate(x, renderY);
      // Apply rotation if present
      const rotation = (entity.components.RenderComponent.rotation || 0);
      this.ctx.rotate(rotation);
      // Blue glow if player and XP >= 50
      if (entity.id === 'player' && getXP() >= 50) {
        this.ctx.shadowColor = '#12e0ff';
        this.ctx.shadowBlur = 32;
      }
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      // Draw a line to show rotation
      this.ctx.strokeStyle = '#e53d8f';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(0, 0);
      this.ctx.lineTo(0, -size);
      this.ctx.stroke();
      this.ctx.restore();
      // Draw label above the ball
      this.ctx.fillStyle = "white";
      this.ctx.font = "14px sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText(label, x, renderY - size - 8);

      // --- Particle update & render (only once per frame when player processed) ---
      if (entity.id === 'player') {
        // Spawn particle if up-dashing or wallBounceParticle
        const control = entity.components.PlayerControlComponent;
        if (control && (control.isUpDash || control.wallBounceParticle)) {
          // Create several particles per frame for a richer trail
          for (let i = 0; i < 3; i++) {
            this.particles.push({
              x: entity.components.PositionComponent.x + (Math.random() - 0.5) * 10,
              y: entity.components.PositionComponent.y + (Math.random() - 0.5) * 10,
              vx: (Math.random() - 0.5) * 0.6,
              vy: 2 + Math.random() * 1,
              life: 30 // frames
            });
          }
          // Only spawn wallBounceParticle for one frame
          if (control.wallBounceParticle) {
            control.wallBounceParticle = false;
          }
        }

        // Update and draw particles
        this.ctx.save();
        this.particles.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 1;
        });
        // Remove dead particles
        this.particles = this.particles.filter(p => p.life > 0);

        this.particles.forEach(p => {
          const renderY = p.y - cameraOffsetY;
          const alpha = p.life / 30; // fade out
          this.ctx.save();
          this.ctx.globalAlpha = alpha;
          this.ctx.fillStyle = '#12e0ff';
          this.ctx.shadowColor = '#12e0ff';
          this.ctx.shadowBlur = 10;
          this.ctx.beginPath();
          this.ctx.arc(p.x, renderY, 4, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.restore();
        });
        this.ctx.restore();
      }
    }
  }
} 