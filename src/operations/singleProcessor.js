const { buildWhereClause } = require('../utils');
const {
  optionsWithTransaction,
  notFoundWithRollback,
  normalizeId,
} = require('../operationUtils');
const {
  flattenResponseData,
} = require('../listUtils');

/**
 * Converts record to plain object
 */
function convertToPlainObject(recordPayload) {
  const isObject = recordPayload && typeof recordPayload === 'object';
  if (!isObject) {
    return recordPayload;
  }

  const hasGetMethod = recordPayload.get;
  if (hasGetMethod) {
    return recordPayload.get({ plain: true });
  }

  return Object.assign({}, recordPayload);
}

/**
 * Builds query options for single record lookup
 */
function buildQueryOptions(
  req,
  modelOptions,
  ownershipWhere,
  idMapping,
  paramValue
) {
  const where = buildWhereClause(ownershipWhere, idMapping, paramValue);

  const modelWhere = (modelOptions && modelOptions.where) || {};
  const reqOptionsWhere =
    (req.apialize && req.apialize.options && req.apialize.options.where) || {};

  const fullWhere = Object.assign({}, modelWhere, reqOptionsWhere, where);

  const baseOptions = Object.assign(
    {},
    modelOptions,
    req.apialize?.options || {}
  );
  baseOptions.where = fullWhere;

  return baseOptions;
}

/**
 * Gets ownership where clause from request
 */
function getOwnershipWhere(req) {
  const hasApializeOptions =
    req.apialize && req.apialize.options && req.apialize.options.where;

  if (hasApializeOptions) {
    return req.apialize.options.where;
  }

  return {};
}

/**
 * Main single request processor
 * @param {Object} context - Transaction and hooks context
 * @param {Object} config - Operation configuration
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Object} Response payload
 */
async function processSingleRequest(context, config, req, res) {
  const paramValue = req.params[config.param_name];
  const ownershipWhere = getOwnershipWhere(req);

  const queryOptions = buildQueryOptions(
    req,
    context.modelOptions,
    ownershipWhere,
    config.id_mapping,
    paramValue
  );

  const findOptions = optionsWithTransaction(queryOptions, context.transaction);

  const result = await context.model.findOne(findOptions);

  const hasResult = result != null;
  if (!hasResult) {
    return notFoundWithRollback(context);
  }

  context.record = result;
  let recordPayload = convertToPlainObject(result);
  recordPayload = normalizeId(recordPayload, config.id_mapping);

  // Apply flattening if configured
  if (config.flattening) {
    const flattenedArray = flattenResponseData([recordPayload], config.flattening);
    recordPayload = flattenedArray[0];
  }

  context.payload = { success: true, record: recordPayload };
  return context.payload;
}

module.exports = {
  processSingleRequest,
};
