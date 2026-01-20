export class Entity {
  constructor(id, components = {}) {
    this.id = id;
    this.components = components;
  }
} 