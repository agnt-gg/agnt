import { Entity } from '../core/Entity.js';
import { PositionComponent } from '../components/PositionComponent.js';
import { VelocityComponent } from '../components/VelocityComponent.js';
import { RenderComponent } from '../components/RenderComponent.js';
import { PlayerControlComponent } from '../components/PlayerControlComponent.js';
import { PhysicsComponent } from '../components/PhysicsComponent.js';

export function createPlayer(x, y) {
  return new Entity("player", {
    PositionComponent: PositionComponent(x, y),
    VelocityComponent: VelocityComponent(),
    RenderComponent: RenderComponent("#12e0ff", 24, "", 0),
    PlayerControlComponent: PlayerControlComponent(),
    PhysicsComponent: PhysicsComponent(),
    rotation: 0 // for rolling animation
  });
} 