const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  filterMiddlewareFns,
  buildHandlers,
  getOwnershipWhere,
  extractMiddleware,
  extractOption,
  buildWhereClause,
} = require('./utils');
const {
  withTransactionAndHooks,
  optionsWithTransaction,
  notFoundWithRollback,
} = require('./operationUtils');

function buildDestroyOptions(modelOptions, where, transaction) {
  const txModelOptions = Object.assign({}, modelOptions, {
    where: where,
  });
  return optionsWithTransaction(txModelOptions, transaction);
}

function executeDestroy(
  model,
  id,
  id_mapping,
  ownershipWhere,
  modelOptions,
  context
) {
  const where = buildWhereClause(ownershipWhere, id_mapping, id);
  const destroyOptions = buildDestroyOptions(
    modelOptions,
    where,
    context.transaction
  );

  return model.destroy(destroyOptions).then((affected) => {
    if (!affected) {
      return notFoundWithRollback(context);
    }
    context.payload = { success: true, id: id };
    return context.payload;
  });
}

function createDestroyHandler(handleDestroy) {
  return function (req, res, next) {
    return handleDestroy(req, res, next);
  };
}

function attachDestroyRoute(router, middlewares) {
  const routeArgs = ['/:id'];
  for (let i = 0; i < middlewares.length; i++) {
    routeArgs.push(middlewares[i]);
  }
  router.delete.apply(router, routeArgs);
}

function destroy(model, options, modelOptions) {
  if (!options) {
    options = {};
  }
  if (!modelOptions) {
    modelOptions = {};
  }

  ensureFn(model, 'destroy');

  const middleware = extractMiddleware(options);
  const id_mapping = extractOption(options, 'id_mapping', 'id');
  const pre = extractOption(options, 'pre', null);
  const post = extractOption(options, 'post', null);

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
        const id = req.params.id;
        const ownershipWhere = getOwnershipWhere(req);

        return await executeDestroy(
          model,
          id,
          id_mapping,
          ownershipWhere,
          modelOptions,
          context
        );
      }
    );

    if (!res.headersSent) {
      res.json(payload);
    }
  });

  const destroyHandler = createDestroyHandler(handleDestroy);
  const middlewares = buildHandlers(inlineMiddleware, destroyHandler);
  attachDestroyRoute(router, middlewares);

  router.apialize = {};
  return router;
}

module.exports = destroy;
