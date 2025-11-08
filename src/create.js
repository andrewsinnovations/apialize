const {
  createOperationHandler,
  OPERATION_TYPES,
} = require('./operationHandler');

function create(model, options = {}, modelOptions = {}) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.CREATE,
    options,
    modelOptions
  );

  router.post('/', handlers);
  router.apialize = {};
  return router;
}

module.exports = create;
