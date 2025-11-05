const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  filterMiddlewareFns,
  buildHandlers,
  getOwnershipWhere,
} = require('./utils');
const {
  withTransactionAndHooks,
  optionsWithTransaction,
  notFoundWithRollback,
} = require('./operationUtils');

function destroy(model, options = {}, modelOptions = {}) {
  ensureFn(model, 'destroy');

  const middleware = Array.isArray(options.middleware)
    ? options.middleware
    : [];
  const id_mapping = Object.prototype.hasOwnProperty.call(options, 'id_mapping')
    ? options.id_mapping
    : 'id';
  const pre = Object.prototype.hasOwnProperty.call(options, 'pre')
    ? options.pre
    : null;
  const post = Object.prototype.hasOwnProperty.call(options, 'post')
    ? options.post
    : null;

  const inlineMiddleware = filterMiddlewareFns(middleware);

  const router = express.Router({ mergeParams: true });

  const handleDestroy = asyncHandler(async function handleDestroy(req, res) {
    const hookOptions = Object.assign({}, options, { pre: pre, post: post });

    const payload = await withTransactionAndHooks(
      {
        model: model,
        options: hookOptions,
        req: req,
        res: res,
        modelOptions: modelOptions,
        idMapping: id_mapping,
      },
      async function (context) {
        // Extract ID and ownership after pre-hooks (so pre-hooks can modify them)
        const id = req.params.id;
        const ownershipWhere = getOwnershipWhere(req);

        const where = Object.assign({}, ownershipWhere);
        where[id_mapping] = id;

        const txModelOptions = Object.assign({}, modelOptions, {
          where: where,
        });
        const destroyOptions = optionsWithTransaction(
          txModelOptions,
          context.transaction
        );

        const affected = await model.destroy(destroyOptions);
        if (!affected) {
          return notFoundWithRollback(context);
        }
        context.payload = { success: true, id: id };
        return context.payload;
      }
    );

    if (!res.headersSent) {
      res.json(payload);
    }
  });

  const middlewares = buildHandlers(inlineMiddleware, (req, res, next) =>
    handleDestroy(req, res, next)
  );
  router.delete.apply(router, ['/:id'].concat(middlewares));

  router.apialize = {};
  return router;
}

module.exports = destroy;
