import { PLATFORM_COLOR } from '../config.js';

export function createPlatform(x, y, width, height, angle = (Math.random() - 0.5) * Math.PI / 3) {
  return {
    id: `platform:${Date.now()}:${Math.random()}`,
    components: {
      PositionComponent: { x, y },
      RenderComponent: { color: PLATFORM_COLOR, size: 0, label: '' },
      PlatformComponent: { width, height, angle }
    }
  };
} 