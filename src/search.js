const {
  createOperationHandler,
  OPERATION_TYPES,
} = require('./operationHandler');

function disableQueryFilters(req, res, next) {
  req._apializeDisableQueryFilters = true;
  next();
}

function search(model, options = {}, modelOptions = {}) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.SEARCH,
    options,
    modelOptions
  );

  const mountPath = options.path || '/search';
  router.post(mountPath, disableQueryFilters, ...handlers);
  router.apialize = {};
  return router;
}

module.exports = search;
