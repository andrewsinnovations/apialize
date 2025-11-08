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
    if (!config.allowFiltering) {
      req._apializeDisableQueryFilters = true;
    }
    next();
  };

  router.get('/', filteringMiddleware, ...handlers);
  router.apialize = {};
  return router;
}

module.exports = list;
