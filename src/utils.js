const express = require('express');

function apializeContext(req, res, next) {
  const existing =
    req && req.apialize && typeof req.apialize === 'object' ? req.apialize : {};
  const existingOptions =
    existing && existing.options && typeof existing.options === 'object'
      ? existing.options
      : {};
  const existingValues =
    existing && existing.values && typeof existing.values === 'object'
      ? existing.values
      : {};
  const existingWhere =
    existingOptions &&
    existingOptions.where &&
    typeof existingOptions.where === 'object'
      ? existingOptions.where
      : {};

  const mergedWhere = {};
  for (const key in existingWhere) {
    if (Object.prototype.hasOwnProperty.call(existingWhere, key)) {
      mergedWhere[key] = existingWhere[key];
    }
  }

  if (!req._apializeDisableQueryFilters) {
    const query =
      req && req.query && typeof req.query === 'object' ? req.query : {};
    for (const key in query) {
      if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
      if (
        key === 'api:page' ||
        key === 'api:pagesize' ||
        key === 'api:orderby' ||
        key === 'api:orderdir' ||
        key.indexOf('.') !== -1 ||
        key.indexOf(':') !== -1
      ) {
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
  for (const key in existingValues) {
    if (Object.prototype.hasOwnProperty.call(existingValues, key)) {
      values[key] = existingValues[key];
    }
  }
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  for (const key in body) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      values[key] = body[key];
    }
  }

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
  // Preserve the raw request body separately for operations that need
  // access to the unmerged payload (e.g., batch create with array bodies).
  if (req && typeof req.body !== 'undefined') {
    apialize.body = req.body;
  }

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
    } catch (err) {
      next(err);
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

/**
 * Return only functions from a middleware array; tolerates non-arrays.
 */
function filterMiddlewareFns(mw) {
  const result = [];
  if (Array.isArray(mw)) {
    for (let i = 0; i < mw.length; i += 1) {
      if (typeof mw[i] === 'function') result.push(mw[i]);
    }
  }
  return result;
}

function buildHandlers(middleware, handler) {
  const inline = filterMiddlewareFns(middleware);
  return [apializeContext, ...inline, asyncHandler(handler)];
}

function getOwnershipWhere(req) {
  const where =
    req && req.apialize && req.apialize.options && req.apialize.options.where;
  return where && typeof where === 'object' ? where : {};
}

function getProvidedValues(req) {
  if (req && req.apialize) {
    // Prefer middleware-merged values when available; fall back to raw body
    if (req.apialize.values && typeof req.apialize.values === 'object') {
      return req.apialize.values;
    }
    if (typeof req.apialize.body !== 'undefined') return req.apialize.body;
  }
  if (req && req.body) return req.body;
  return {};
}

function getIdFromInstance(instance, idMapping) {
  const key = idMapping || 'id';
  let idValue;
  if (instance && typeof instance.get === 'function') {
    idValue = instance.get(key);
  }
  if (typeof idValue === 'undefined' && instance) {
    if (typeof instance[key] !== 'undefined') {
      idValue = instance[key];
    } else if (
      instance.dataValues &&
      typeof instance.dataValues[key] !== 'undefined'
    ) {
      idValue = instance.dataValues[key];
    }
  }
  if (typeof idValue === 'undefined' && instance) {
    if (typeof instance.id !== 'undefined') {
      idValue = instance.id;
    } else if (
      instance.dataValues &&
      typeof instance.dataValues.id !== 'undefined'
    ) {
      idValue = instance.dataValues.id;
    }
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
    const reqOpts = req.apialize.options;
    for (const k in reqOpts) {
      if (Object.prototype.hasOwnProperty.call(reqOpts, k)) {
        merged[k] = reqOpts[k];
      }
    }
  }
  return merged;
}

module.exports.filterMiddlewareFns = filterMiddlewareFns;
module.exports.buildHandlers = buildHandlers;
module.exports.getOwnershipWhere = getOwnershipWhere;
module.exports.getProvidedValues = getProvidedValues;
module.exports.getIdFromInstance = getIdFromInstance;
module.exports.mergeReqOptionsIntoModelOptions =
  mergeReqOptionsIntoModelOptions;
