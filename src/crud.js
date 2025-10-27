const { express } = require('./utils');
const list = require('./list');
const single = require('./single');
const create = require('./create');
const update = require('./update');
const patch = require('./patch');
const destroy = require('./destroy');
const search = require('./search');

function crud(model, options = {}, modelOptions = {}) {
  const { middleware = [], routes = {} } = options || {};
  const router = express.Router({ mergeParams: true });
  const collect = (arr) => [...middleware, ...(arr || [])];
  router.use(list(model, { middleware: collect(routes.list) }, modelOptions));
  // Include search by default at '/search'. Use individual mounts if you need a custom path.
  router.use(
    search(model, { middleware: collect(routes.search) }, modelOptions)
  );
  router.use(
    single(model, { middleware: collect(routes.single) }, modelOptions)
  );
  router.use(
    create(model, { middleware: collect(routes.create) }, modelOptions)
  );
  router.use(
    update(model, { middleware: collect(routes.update) }, modelOptions)
  );
  router.use(patch(model, { middleware: collect(routes.patch) }, modelOptions));
  router.use(
    destroy(model, { middleware: collect(routes.destroy) }, modelOptions)
  );
  return router;
}

module.exports = crud;
