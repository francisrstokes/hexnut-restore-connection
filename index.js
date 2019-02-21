const uuid = require('uuid/v4');

const RESTORE_SYMBOL = Symbol('@@ConnectionRestore');
const msgRegex = /ConnectionRestoreRequest:([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}){1}/;

const copyToCtx = (ctx, oldCtx, keysToOmit) => {
  Object.keys(oldCtx)
    .filter(key => !keysToOmit.includes(key))
    .forEach(key => ctx[key] = oldCtx[key]);
};

const restoreConnectionMiddleware = (opts = {}) => {
  if (typeof opts !== 'object') {
    throw new TypeError('Restore Connection Middleware: opts must be an object');
  }

  const {
    lifetime = 1000 * 60 * 60,
    cleanupInterval = 1000 * 60 * 60,
    omitKeys = []
  } = opts;
  const keysToOmit = [
    ...omitKeys,
    '@@WebsocketConnection',
    '@@WebsocketRequest',
    'message',
  ];

  return async (ctx, next) => {
    const app = ctx.app;
    const now = Date.now();

    if (!app[RESTORE_SYMBOL]) {
      app[RESTORE_SYMBOL] = {};
      app.restoreMiddlewareInterval = setInterval(() => {
        Object.entries(app[RESTORE_SYMBOL]).forEach(([key, {timestamp}]) => {
          if (timestamp + lifetime < now) {
            delete app[RESTORE_SYMBOL][key];
          }
        })
      }, cleanupInterval);
    }

    if (ctx.isConnection) {
      const id = uuid();
      ctx[RESTORE_SYMBOL] = { id, timestamp: Date.now() };
      app[RESTORE_SYMBOL][id] = ctx;
      ctx.send(JSON.stringify({ type: 'ConnectionRestoreId', value: id }));
    } else {
      if (typeof ctx.message === 'string') {
        const match = ctx.message.match(msgRegex);

        if (match && match[1] in app[RESTORE_SYMBOL]) {
          const oldId = match[1];
          const currentId = ctx[RESTORE_SYMBOL].id;
          const oldCtx = app[RESTORE_SYMBOL][oldId];

          if (oldCtx[RESTORE_SYMBOL].timestamp + lifetime > now) {
            copyToCtx(ctx, oldCtx, keysToOmit);
            delete app[RESTORE_SYMBOL][currentId];
            ctx.send(JSON.stringify({ type: 'ConnectionRestoreStatus', value: 'restored' }));
            return;
          } else {
            delete app[RESTORE_SYMBOL][oldId];
            ctx.send(JSON.stringify({ type: 'ConnectionRestoreStatus', value: 'timed out' }));
            return;
          }
        }
      }
    }

    return await next();
  };
}

module.exports = restoreConnectionMiddleware;