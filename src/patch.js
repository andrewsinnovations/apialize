const {
  createOperationHandler,
  OPERATION_TYPES,
} = require('./operationHandler');

function patch(model, options = {}, modelOptions = {}) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.PATCH,
    options,
    modelOptions
  );

  router.patch('/:id', handlers);
  router.apialize = {};
  return router;
}

module.exports = patch;
