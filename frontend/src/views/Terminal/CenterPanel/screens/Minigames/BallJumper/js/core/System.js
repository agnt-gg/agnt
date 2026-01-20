export class System {
  constructor(required = []) {
    this.required = required;
  }
  matches(entity) {
    return this.required.every(c => c in entity.components);
  }
  run(entity, world) {}
} 