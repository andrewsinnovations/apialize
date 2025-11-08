const {
  getOwnershipWhere,
  buildWhereClause,
  copyOwnProperties,
  extractIdFromRequest,
} = require('../utils');
const {
  optionsWithTransaction,
  notFoundWithRollback,
} = require('../operationUtils');

function buildDestroyOptions(modelOptions, where, transaction) {
  const txModelOptions = {};
  copyOwnProperties(modelOptions, txModelOptions);

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

function executeDestroy(
  model,
  id,
  idMapping,
  ownershipWhere,
  modelOptions,
  context
) {
  const where = buildWhereClause(ownershipWhere, idMapping, id);
  const destroyOptions = buildDestroyOptions(
    modelOptions,
    where,
    context.transaction
  );

  return model.destroy(destroyOptions).then((affected) => {
    return handleDestroyResult(affected, id, context);
  });
}

async function processDestroyRequest(context, config, req, res) {
  const id = extractIdFromRequest(req);
  const ownershipWhere = getOwnershipWhere(req);

  return await executeDestroy(
    context.model,
    id,
    config.id_mapping,
    ownershipWhere,
    context.modelOptions,
    context
  );
}

module.exports = {
  processDestroyRequest,
};
