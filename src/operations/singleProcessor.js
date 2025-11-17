const { buildWhereClause } = require('../utils');
const {
  optionsWithTransaction,
  notFoundWithRollback,
  normalizeId,
} = require('../operationUtils');
const {
  flattenResponseData,
  validateFlatteningConfig,
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
 * Gets includes from request context, model options, and model scope
 */
function getIncludesFromContext(req, model, modelOptions) {
  // Ensure req.apialize and req.apialize.options exist
  if (!req.apialize) {
    req.apialize = {};
  }
  if (!req.apialize.options) {
    req.apialize.options = {};
  }

  let includes = req.apialize.options.include || [];

  // Add includes from modelOptions
  if (modelOptions && modelOptions.include) {
    const modelOptionsIncludes = Array.isArray(modelOptions.include)
      ? modelOptions.include
      : [modelOptions.include];

    if (Array.isArray(includes)) {
      includes = [...includes, ...modelOptionsIncludes];
    } else {
      includes = [...modelOptionsIncludes, includes];
    }
  }

  // Add includes from model scope
  if (model && model._scope && model._scope.include) {
    const scopeIncludes = Array.isArray(model._scope.include)
      ? model._scope.include
      : [model._scope.include];

    if (Array.isArray(includes)) {
      includes = [...includes, ...scopeIncludes];
    } else {
      includes = [...scopeIncludes, includes];
    }
  }

  return includes;
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

  // Validate and auto-create includes from flattening config if needed
  if (config.flattening) {
    const includes = getIncludesFromContext(req, context.model, context.modelOptions);
    const validation = validateFlatteningConfig(
      config.flattening,
      context.model,
      includes
    );

    if (!validation.isValid) {
      const error = new Error(validation.error || 'Bad request');
      error.name = 'ValidationError';
      error.statusCode = 400;
      throw error;
    }

    // If include was auto-created, update the request options
    if (validation.autoCreated) {
      req.apialize.options.include = includes;
    }
  }

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
    const flattenedArray = flattenResponseData(
      [recordPayload],
      config.flattening
    );
    recordPayload = flattenedArray[0];
  }

  context.payload = { success: true, record: recordPayload };
  return context.payload;
}

module.exports = {
  processSingleRequest,
};
