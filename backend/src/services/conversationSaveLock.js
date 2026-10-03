const saves = new Map();
export async function acquireConversationSave(userId, address) {
  const key = JSON.stringify([userId, address]);
  const previous = saves.get(key);
  let release;
  const current = new Promise(resolve => { release = resolve; });
  saves.set(key, current);
  if (previous) await previous;
  return () => { if (saves.get(key) === current) saves.delete(key); release(); };
}
