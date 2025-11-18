const {
  createOperationHandler,
  OPERATION_TYPES,
} = require('./operationHandler');

function list(model, options = {}, modelOptions = {}) {
  const { router, handlers, config } = createOperationHandler(
    model,
    OPERATION_TYPES.LIST,
    options,
    modelOptions
  );

  const filteringMiddleware = function (req, _res, next) {
    // Always disable automatic query filtering for list endpoint
    // The list processor converts query params to search body and passes to search processor
    req._apializeDisableQueryFilters = true;
    next();
  };

  router.get('/', filteringMiddleware, ...handlers);
  router.apialize = {};
  return router;
}

module.exports = list;
