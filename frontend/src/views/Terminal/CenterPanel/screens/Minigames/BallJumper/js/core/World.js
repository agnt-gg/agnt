export class World {
  constructor() {
    this.entities = [];
    this.systems = [];
  }
  addEntity(e) { this.entities.push(e); }
  addSystem(s) { this.systems.push(s); }
  tick() {
    this.systems.forEach(system => {
      this.entities.forEach(entity => {
        if (system.matches(entity)) {
          system.run(entity, this);
        }
      });
    });
  }
} 