const {
  createOperationHandler,
  OPERATION_TYPES,
} = require('./operationHandler');

function destroy(model, options = {}, modelOptions = {}) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.DESTROY,
    options,
    modelOptions
  );

  router.delete('/:id', handlers);
  router.apialize = {};
  return router;
}

module.exports = destroy;
