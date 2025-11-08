const {
  createOperationHandler,
  OPERATION_TYPES,
} = require('./operationHandler');

function update(model, options = {}, modelOptions = {}) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.UPDATE,
    options,
    modelOptions
  );

  router.put('/:id', handlers);
  router.apialize = {};
  return router;
}

module.exports = update;
