const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  filterMiddlewareFns,
  buildHandlers,
  getIdFromInstance,
} = require('./utils');
const {
  withTransactionAndHooks,
  optionsWithTransaction,
} = require('./operationUtils');

function create(model, options = {}, modelOptions = {}) {
  ensureFn(model, 'create');

  const middleware = Array.isArray(options && options.middleware)
    ? options.middleware
    : [];
  const id_mapping =
    typeof (options && options.id_mapping) !== 'undefined'
      ? options.id_mapping
      : 'id';
  const pre =
    typeof (options && options.pre) !== 'undefined' ? options.pre : null;
  const post =
    typeof (options && options.post) !== 'undefined' ? options.post : null;

  const inline = filterMiddlewareFns(middleware);

  const router = express.Router({ mergeParams: true });

  const handlers = buildHandlers(inline, async (req, res) => {
    const effectiveOptions = Object.assign({}, options, {
      pre: pre,
      post: post,
    });

    const payload = await withTransactionAndHooks(
      {
        model: model,
        options: effectiveOptions,
        req: req,
        res: res,
        modelOptions: modelOptions,
        idMapping: id_mapping,
      },
      async function (context) {
        const mergedCreateOptions = {};
        if (modelOptions && typeof modelOptions === 'object') {
          for (const key in modelOptions) {
            if (Object.prototype.hasOwnProperty.call(modelOptions, key)) {
              mergedCreateOptions[key] = modelOptions[key];
            }
          }
        }
        if (
          req &&
          req.apialize &&
          req.apialize.options &&
          typeof req.apialize.options === 'object'
        ) {
          const reqOptions = req.apialize.options;
          for (const key in reqOptions) {
            if (Object.prototype.hasOwnProperty.call(reqOptions, key)) {
              mergedCreateOptions[key] = reqOptions[key];
            }
          }
        }

        const createOptions = optionsWithTransaction(
          mergedCreateOptions,
          context.transaction
        );

        const values = req && req.apialize ? req.apialize.values : undefined;
        const created = await model.create(values, createOptions);
        context.created = created;

        const idValue = getIdFromInstance(created, id_mapping);

        context.payload = { success: true, id: idValue };
        return context.payload;
      }
    );

    if (!res.headersSent) {
      res.status(201).json(payload);
    }
  });

  router.post('/', handlers);

  router.apialize = {};
  return router;
}

module.exports = create;
