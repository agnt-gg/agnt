import { World } from './core/World.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { PlayerControlSystem } from './systems/PlayerControlSystem.js';
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { PlatformCollisionSystem } from './systems/PlatformCollisionSystem.js';
import { initWorld, getHeight, getHighestPlatformY, spawnPlatformAbove, getXP } from './entities/initWorld.js';
import { setBounceBaseline } from './utils/audio.js';
import { showNotification } from './utils/notification.js';
import { showHelpTour } from './components/HelpTour.js';

export default function runBallJumperGame(canvas) {
  const ctx = canvas.getContext('2d');

  // Resize canvas to fill window
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const world = new World();
  window.world = world;

  // Initialize world entities (player, platforms)
  initWorld(world, canvas);

  let cameraOffsetY = 0;
  let topHeightRecord = 0;
  let lastFakeNotifTime = 0;
  let frameId = null;

  // Set initial cameraOffsetY so ground is at the bottom
  const player = world.entities.find((e) => e.id === 'player');
  if (player) {
    const playerY = player.components.PositionComponent.y;
    cameraOffsetY = playerY - canvas.height / 2;
    const groundY = canvas.height - 24; // 24 is player radius
    if (playerY >= groundY && cameraOffsetY < 0) cameraOffsetY = 0;

    // Use player's starting height as baseline for bounce melody
    setBounceBaseline(playerY);
  }

  world.addSystem(new PlayerControlSystem());
  world.addSystem(new PhysicsSystem(() => canvas.height));
  world.addSystem(new PlatformCollisionSystem());
  world.addSystem(new RenderSystem(ctx, () => cameraOffsetY));

  function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    world.tick();

    // Find player
    const player = world.entities.find((e) => e.id === 'player');
    if (player) {
      const playerY = player.components.PositionComponent.y;
      const velocity = player.components.VelocityComponent;
      const physics = player.components.PhysicsComponent;
      const control = player.components.PlayerControlComponent;
      // Camera only follows after player reaches threshold
      const threshold = canvas.height / 2;
      if (playerY < threshold) {
        cameraOffsetY = playerY - threshold;
      } else {
        cameraOffsetY = 0;
      }
      // If player is within 200px of the highest platform, spawn a new one
      if (playerY < getHighestPlatformY() + 200) {
        spawnPlatformAbove(world, canvas);
      }

      // --- Fake random notification when at bottom 5% ---
      const bottomThreshold = canvas.height * 0.95;
      const now = performance.now();
      if (playerY >= bottomThreshold && now - lastFakeNotifTime > 10000 && Math.random() < 1 / 10) {
        const fakeNames = ['RandomPlayer69', 'EpicGamer42', 'SkyJumper', 'PixelNinja', 'BounceKing', 'CloudSurfer', 'Jumpster', 'StarHopper'];
        const emojis = ['🎉', '⭐', '🏆', '🔥', '😎', '🚀', '👏', '💯'];
        const name = fakeNames[Math.floor(Math.random() * fakeNames.length)];
        // Fake score: between topHeightRecord and topHeightRecord * 1.1 (rounded)
        let minScore = Math.max(1000, topHeightRecord);
        let maxScore = Math.round(minScore * 1.1);
        let score = minScore;
        if (maxScore > minScore) {
          score = Math.floor(Math.random() * (maxScore - minScore + 1)) + minScore;
        }
        const scoreStr = score.toLocaleString();
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        showNotification(`${name} just reached ${scoreStr}! ${emoji}`);
        lastFakeNotifTime = now;
      }
    }

    // --- Height record notification ---
    const currentHeight = getHeight();
    if (currentHeight > topHeightRecord) {
      if (topHeightRecord > 0 && currentHeight >= 1000) {
        showNotification(`New Height Record! ${currentHeight}`);
      }
      topHeightRecord = currentHeight;
    }

    // Draw height and XP together, left-aligned
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.font = '24px sans-serif';
    const leftPad = 20; // Move closer to the left edge
    const topPad = 36; // Top padding for first line
    ctx.textAlign = 'left'; // Ensure left alignment
    ctx.fillText('Height: ' + getHeight(), leftPad, topPad);
    ctx.font = '20px sans-serif';
    let xpColor = 'white';
    if (getXP() >= 50) {
      ctx.shadowColor = '#0099ff';
      ctx.shadowBlur = 36;
      xpColor = '#00aaff';
    }
    ctx.fillStyle = xpColor;
    ctx.fillText('XP: ' + getXP(), leftPad, topPad + 28); // 28px below height
    ctx.shadowBlur = 0;
    ctx.restore();

    frameId = requestAnimationFrame(gameLoop);
  }

  // Add help button to the DOM
  const helpBtn = document.createElement('button');
  helpBtn.textContent = '?';
  helpBtn.className = 'help-btn';
  helpBtn.title = 'How to Play';
  helpBtn.onclick = showHelpTour;
  document.body.appendChild(helpBtn);

  // Inject help tour CSS if not present
  if (!document.getElementById('help-tour-style')) {
    const style = document.createElement('style');
    style.id = 'help-tour-style';
    style.textContent = `
      .help-btn {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 1001;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        color: #fff;
        font-size: 1.6em;
        border: none;
        cursor: pointer;
        opacity: 0.85;
        transition: background 0.2s;
      }
      .help-btn:hover { background: #444; }
      .help-tour-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.82);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .help-tour-modal {
        background: #222;
        color: #fff;
        padding: 32px 28px 20px 28px;
        border-radius: 16px;
        max-width: 340px;
        box-shadow: 0 4px 32px #000a;
        text-align: center;
      }
      .help-tour-modal h2 {
        margin-top: 0;
        font-size: 1.5em;
      }
      .help-tour-modal pre {
        text-align: left;
        background: none;
        color: #fff;
        font-size: 1.1em;
        margin: 18px 0 18px 0;
        white-space: pre-line;
      }
      .help-tour-nav {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 10px;
      }
      .help-tour-nav button {
        background: #444;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 6px 16px;
        font-size: 1em;
        cursor: pointer;
        transition: background 0.2s;
      }
      .help-tour-nav button:disabled {
        background: #222;
        color: #888;
        cursor: default;
      }
      .help-tour-nav button:hover:not(:disabled) {
        background: #666;
      }
    `;
    document.head.appendChild(style);
  }
  gameLoop();

  // At the end, return a cleanup function:
  return () => {
    if (frameId) cancelAnimationFrame(frameId);
    window.removeEventListener('resize', resizeCanvas);
    // Remove help button if you added it
    if (helpBtn && helpBtn.parentNode) helpBtn.parentNode.removeChild(helpBtn);
    // Remove injected style if needed
    const style = document.getElementById('help-tour-style');
    if (style && style.parentNode) style.parentNode.removeChild(style);
  };
}
