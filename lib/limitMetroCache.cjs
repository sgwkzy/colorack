module.exports = function limitMetroCache(store, limit = 32) {
  let active = 0;
  const waiting = [];

  async function run(operation) {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }

  return {
    name: store.name ?? store.constructor.name,
    get: (key) => run(() => store.get(key)),
    set: (key, value) => run(() => store.set(key, value)),
    clear: () => store.clear(),
  };
};
