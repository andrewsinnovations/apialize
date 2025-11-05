const { express } = require('./utils');
const list = require('./list');
const single = require('./single');
const create = require('./create');
const update = require('./update');
const patch = require('./patch');
const destroy = require('./destroy');
const search = require('./search');

function extractMiddleware(options) {
  if (options && Array.isArray(options.middleware)) {
    return options.middleware;
  }
  return [];
}

function extractRoutes(options) {
  if (options && options.routes && typeof options.routes === 'object') {
    return options.routes;
  }
  return {};
}

function collectMiddleware(baseMiddleware, routeMiddleware) {
  const collected = [];

  for (let i = 0; i < baseMiddleware.length; i++) {
    collected.push(baseMiddleware[i]);
  }

  if (routeMiddleware && Array.isArray(routeMiddleware)) {
    for (let i = 0; i < routeMiddleware.length; i++) {
      collected.push(routeMiddleware[i]);
    }
  }

  return collected;
}

function mountRoute(
  router,
  routeHandler,
  model,
  baseMiddleware,
  routeMiddleware,
  modelOptions
) {
  const combinedMiddleware = collectMiddleware(baseMiddleware, routeMiddleware);
  const routeOptions = { middleware: combinedMiddleware };
  const routeInstance = routeHandler(model, routeOptions, modelOptions);
  router.use(routeInstance);
}

function crud(model, options, modelOptions) {
  if (!options) {
    options = {};
  }
  if (!modelOptions) {
    modelOptions = {};
  }

  const middleware = extractMiddleware(options);
  const routes = extractRoutes(options);
  const router = express.Router({ mergeParams: true });

  mountRoute(router, list, model, middleware, routes.list, modelOptions);
  mountRoute(router, search, model, middleware, routes.search, modelOptions);
  mountRoute(router, single, model, middleware, routes.single, modelOptions);
  mountRoute(router, create, model, middleware, routes.create, modelOptions);
  mountRoute(router, update, model, middleware, routes.update, modelOptions);
  mountRoute(router, patch, model, middleware, routes.patch, modelOptions);
  mountRoute(router, destroy, model, middleware, routes.destroy, modelOptions);

  return router;
}

module.exports = crud;
