const express = require('express');
const { createHelpers } = require('./contextHelpers');

function safeGetObject(source, fallback = {}) {
  if (source && typeof source === 'object') {
    return source;
  }
  return fallback;
}

function copyOwnProperties(source, target) {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = source[key];
    }
  }
}

function isReservedQueryKey(key) {
  if (key === 'api:page') {
    return true;
  }
  if (key === 'api:page_size') {
    return true;
  }
  if (key === 'api:order_by') {
    return true;
  }
  if (key === 'api:order_dir') {
    return true;
  }
  if (key.indexOf('.') !== -1) {
    return true;
  }
  if (key.indexOf(':') !== -1) {
    return true;
  }
  return false;
}

function apializeContext(req, res, next) {
  const existing = safeGetObject(req && req.apialize);
  const existingOptions = safeGetObject(existing.options);
  const existingValues = safeGetObject(existing.values);
  const existingWhere = safeGetObject(existingOptions.where);

  const mergedWhere = {};
  copyOwnProperties(existingWhere, mergedWhere);

  if (!req._apializeDisableQueryFilters) {
    const query = safeGetObject(req && req.query);
    for (const key in query) {
      if (!Object.prototype.hasOwnProperty.call(query, key)) {
        continue;
      }
      if (isReservedQueryKey(key)) {
        continue;
      }
      if (typeof mergedWhere[key] === 'undefined') {
        mergedWhere[key] = query[key];
      }
    }
  }

  const options = {};
  for (const key in existingOptions) {
    if (
      Object.prototype.hasOwnProperty.call(existingOptions, key) &&
      key !== 'where'
    ) {
      options[key] = existingOptions[key];
    }
  }
  options.where = mergedWhere;

  const values = {};
  copyOwnProperties(existingValues, values);

  const body = safeGetObject(req && req.body);
  copyOwnProperties(body, values);

  const apialize = {};
  for (const key in existing) {
    if (
      Object.prototype.hasOwnProperty.call(existing, key) &&
      key !== 'options' &&
      key !== 'values'
    ) {
      apialize[key] = existing[key];
    }
  }
  apialize.options = options;
  apialize.values = values;

  if (req && typeof req.body !== 'undefined') {
    apialize.body = req.body;
  }

  const helpers = createHelpers(req);
  Object.assign(apialize, helpers);

  req.apialize = apialize;
  next();
}

function ensureFn(obj, name) {
  if (!obj || typeof obj[name] !== 'function') {
    throw new Error(`Model is missing required method: ${name}()`);
  }
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

function defaultNotFound(res) {
  res.status(404).json({ success: false, error: 'Not Found' });
}

module.exports = {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  defaultNotFound,
};

function filterMiddlewareFns(middlewareArray) {
  const result = [];
  if (Array.isArray(middlewareArray)) {
    for (let i = 0; i < middlewareArray.length; i += 1) {
      if (typeof middlewareArray[i] === 'function') {
        result.push(middlewareArray[i]);
      }
    }
  }
  return result;
}

function buildHandlers(middleware, handler) {
  const middlewareFunctions = filterMiddlewareFns(middleware);
  const wrappedHandler = asyncHandler(handler);
  return [apializeContext].concat(middlewareFunctions).concat([wrappedHandler]);
}

function getOwnershipWhere(req) {
  if (
    req &&
    req.apialize &&
    req.apialize.options &&
    req.apialize.options.where
  ) {
    const where = req.apialize.options.where;
    if (where && typeof where === 'object') {
      return where;
    }
  }
  return {};
}

function getProvidedValues(req) {
  if (req && req.apialize) {
    if (req.apialize.values && typeof req.apialize.values === 'object') {
      return req.apialize.values;
    }
    if (typeof req.apialize.body !== 'undefined') {
      return req.apialize.body;
    }
  }
  if (req && req.body) {
    return req.body;
  }
  return {};
}

function tryGetValueFromInstance(instance, key) {
  if (instance && typeof instance.get === 'function') {
    return instance.get(key);
  }
  if (instance && typeof instance[key] !== 'undefined') {
    return instance[key];
  }
  if (
    instance &&
    instance.dataValues &&
    typeof instance.dataValues[key] !== 'undefined'
  ) {
    return instance.dataValues[key];
  }
  return undefined;
}

function getIdFromInstance(instance, idMapping) {
  const primaryKey = idMapping || 'id';

  let idValue = tryGetValueFromInstance(instance, primaryKey);
  if (typeof idValue !== 'undefined') {
    return idValue;
  }

  if (primaryKey !== 'id') {
    idValue = tryGetValueFromInstance(instance, 'id');
  }

  return idValue;
}

function mergeReqOptionsIntoModelOptions(req, baseModelOptions) {
  const merged = Object.assign({}, baseModelOptions || {});
  if (
    req &&
    req.apialize &&
    req.apialize.options &&
    typeof req.apialize.options === 'object'
  ) {
    const requestOptions = req.apialize.options;
    copyOwnProperties(requestOptions, merged);
  }
  return merged;
}

// Shared option extraction functions
function extractOption(options, optionName, defaultValue) {
  if (options && typeof options[optionName] !== 'undefined') {
    return options[optionName];
  }
  return defaultValue;
}

function extractBooleanOption(options, optionName, defaultValue) {
  if (options && Object.prototype.hasOwnProperty.call(options, optionName)) {
    return !!options[optionName];
  }
  return defaultValue;
}

function extractMiddleware(options) {
  if (options && Array.isArray(options.middleware)) {
    return options.middleware;
  }
  return [];
}

// Shared where clause building function
function buildWhereClause(ownershipWhere, idMapping, id) {
  const where = Object.assign({}, ownershipWhere);
  where[idMapping] = id;
  return where;
}

// Instance conversion utility
function convertInstanceToPlainObject(instance) {
  if (instance && typeof instance.get === 'function') {
    return instance.get({ plain: true });
  }
  return instance;
}


// Additional shared helpers moved from processors
function extractIdFromRequest(req) {
  if (req && req.params && typeof req.params.id !== 'undefined') {
    return req.params.id;
  }
  return undefined;
}

function extractRequestBody(req) {
  if (req && req.body) return req.body;
  return undefined;
}

function handleValidationError(error, resOrContext) {
  const isValidationError = error && error.name === 'ValidationError';
  if (!isValidationError) return false;

  const res = resOrContext && resOrContext.res ? resOrContext.res : resOrContext;
  if (res && typeof res.status === 'function') {
    res.status(400).json({ success: false, error: error.message, details: error.details });
    return true;
  }

  return false;
}

function extractRawAttributes(model) {
  if (model && model.rawAttributes) return model.rawAttributes;
  if (model && model.prototype && model.prototype.rawAttributes) return model.prototype.rawAttributes;
  return {};
}

function extractAffectedCount(updateResult) {
  if (Array.isArray(updateResult)) return updateResult[0];
  return updateResult;
}

module.exports.filterMiddlewareFns = filterMiddlewareFns;
module.exports.buildHandlers = buildHandlers;
module.exports.getOwnershipWhere = getOwnershipWhere;
module.exports.getProvidedValues = getProvidedValues;
module.exports.getIdFromInstance = getIdFromInstance;
module.exports.mergeReqOptionsIntoModelOptions =
  mergeReqOptionsIntoModelOptions;
module.exports.extractOption = extractOption;
module.exports.extractBooleanOption = extractBooleanOption;
module.exports.extractMiddleware = extractMiddleware;
module.exports.buildWhereClause = buildWhereClause;
module.exports.convertInstanceToPlainObject = convertInstanceToPlainObject;
module.exports.copyOwnProperties = copyOwnProperties;
module.exports.extractIdFromRequest = extractIdFromRequest;
module.exports.extractRequestBody = extractRequestBody;
module.exports.handleValidationError = handleValidationError;
module.exports.extractRawAttributes = extractRawAttributes;
module.exports.extractAffectedCount = extractAffectedCount;
