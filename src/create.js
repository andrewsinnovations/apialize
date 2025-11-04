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
  const allow_bulk_create = Object.prototype.hasOwnProperty.call(
    options || {},
    'allow_bulk_create'
  )
    ? !!options.allow_bulk_create
    : false;
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
        // Check bulk create validation after pre-hooks (so pre-hooks can modify the body/settings)
        const rawBody = req && req.body;
        if (Array.isArray(rawBody) && !allow_bulk_create) {
          context.res.status(400).json({ success: false, error: 'Cannot insert multiple records.' });
          return;
        }
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
        // Array body -> bulk create in a single transaction
        if (Array.isArray(rawBody)) {
          // Ensure bulkCreate is available only when needed
          ensureFn(model, 'bulkCreate');
          const bulkOptions = Object.assign({}, createOptions, {
            returning: true,
            validate: true,
            individualHooks: true,
          });
          const createdArray = await model.bulkCreate(rawBody, bulkOptions);

          const out = createdArray.map((inst) =>
            inst && typeof inst.get === 'function'
              ? inst.get({ plain: true })
              : inst
          );

          if (id_mapping && id_mapping !== 'id') {
            for (let i = 0; i < out.length; i += 1) {
              const row = out[i];
              if (
                row &&
                Object.prototype.hasOwnProperty.call(row, id_mapping) &&
                typeof row[id_mapping] !== 'undefined'
              ) {
                row.id = row[id_mapping];
              }
            }
          }

          context.created = createdArray;
          context.payload = out;
          return context.payload;
        }

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
