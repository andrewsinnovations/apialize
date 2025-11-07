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
  const txModelOptions = {};
  const modelOptionKeys = Object.keys(modelOptions);

  for (let i = 0; i < modelOptionKeys.length; i++) {
    const key = modelOptionKeys[i];
    txModelOptions[key] = modelOptions[key];
  }

  txModelOptions.where = where;

  return optionsWithTransaction(txModelOptions, transaction);
}

function handleDestroyResult(affected, id, context) {
  const recordWasDestroyed = affected > 0;
  if (!recordWasDestroyed) {
    return notFoundWithRollback(context);
  }

  context.payload = { success: true, id: id };
  return context.payload;
}

function buildHookOptions(options, pre, post) {
  const hookOptions = {};
  const optionKeys = Object.keys(options);

  for (let i = 0; i < optionKeys.length; i++) {
    const key = optionKeys[i];
    hookOptions[key] = options[key];
  }

  if (pre !== null) {
    hookOptions.pre = pre;
  }

  if (post !== null) {
    hookOptions.post = post;
  }

  return hookOptions;
}

async function processDestroyRequest(
  model,
  options,
  modelOptions,
  req,
  res,
  config
) {
  const hookOptions = buildHookOptions(options, config.pre, config.post);

  return await withTransactionAndHooks(
    {
      model: model,
      options: hookOptions,
      req: req,
      res: res,
      modelOptions: modelOptions,
      idMapping: config.id_mapping,
    },
    async function (context) {
      const id = req.params.id;
      const ownershipWhere = getOwnershipWhere(req);

      return await executeDestroy(
        model,
        id,
        config.id_mapping,
        ownershipWhere,
        modelOptions,
        context
      );
    }
  );
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
    return handleDestroyResult(affected, id, context);
  });
}

function attachDestroyRoute(router, middlewares) {
  const routeArgs = ['/:id'];
  for (let i = 0; i < middlewares.length; i++) {
    routeArgs.push(middlewares[i]);
  }
  router.delete.apply(router, routeArgs);
}

function destroy(model, options, modelOptions) {
  const safeOptions = options || {};
  const safeModelOptions = modelOptions || {};

  ensureFn(model, 'destroy');

  const middleware = extractMiddleware(safeOptions);
  const id_mapping = extractOption(safeOptions, 'id_mapping', 'id');
  const pre = extractOption(safeOptions, 'pre', null);
  const post = extractOption(safeOptions, 'post', null);

  const inlineMiddleware = filterMiddlewareFns(middleware);
  const router = express.Router({ mergeParams: true });

  const handleDestroy = asyncHandler(async function handleDestroy(req, res) {
    const payload = await processDestroyRequest(
      model,
      safeOptions,
      safeModelOptions,
      req,
      res,
      { pre: pre, post: post, id_mapping: id_mapping }
    );

    const responseNotSent = !res.headersSent;
    if (responseNotSent) {
      res.json(payload);
    }
  });

  const middlewares = buildHandlers(inlineMiddleware, handleDestroy);
  attachDestroyRoute(router, middlewares);

  router.apialize = {};
  return router;
}

module.exports = destroy;
