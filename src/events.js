// Tiny pub/sub shared by the chimes and the labyrinth, so the two halves can
// later react to each other without importing one another.
//   'chime:strike'       { index, freq, velocity, pan }
//   'labyrinth:progress' { s, length, circuit, level }
//   'labyrinth:arrived'  { level, radius }
const handlers = new Map();

export const bus = {
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type).delete(fn);
  },
  emit(type, payload) {
    const set = handlers.get(type);
    if (set) for (const fn of set) fn(payload);
  },
};
