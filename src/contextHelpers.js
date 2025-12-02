const { Op } = require('sequelize');

function ensureApializeStructure(req) {
  if (!req || !req.apialize) {
    throw new Error('Helper must be called on req.apialize object');
  }

  if (!req.apialize.options) {
    req.apialize.options = {};
  }

  if (!req.apialize.options.where) {
    req.apialize.options.where = {};
  }
}

function applyWhere(additionalWhere) {
  const req = this._req;

  ensureApializeStructure(req);

  if (!additionalWhere || typeof additionalWhere !== 'object') {
    return req.apialize.options.where;
  }

  Object.assign(req.apialize.options.where, additionalWhere);
  return req.apialize.options.where;
}

function createScopedModel(model, scope, scopeArgs) {
  if (typeof scope === 'function') {
    const args = [];
    for (let i = 0; i < scopeArgs.length; i++) {
      args.push(scopeArgs[i]);
    }
    return model.scope(scope(...args));
  }

  const hasArguments = scopeArgs.length > 0;
  if (hasArguments) {
    const methodArgs = [scope];
    for (let i = 0; i < scopeArgs.length; i++) {
      methodArgs.push(scopeArgs[i]);
    }
    return model.scope({ method: methodArgs });
  }

  return model.scope(scope);
}

function mergeIncludeOptions(currentInclude, scopeInclude) {
  if (!currentInclude) {
    return scopeInclude;
  }

  const mergedInclude = [];

  if (Array.isArray(currentInclude)) {
    for (let i = 0; i < currentInclude.length; i++) {
      mergedInclude.push(currentInclude[i]);
    }
  } else {
    mergedInclude.push(currentInclude);
  }

  for (let i = 0; i < scopeInclude.length; i++) {
    mergedInclude.push(scopeInclude[i]);
  }

  return mergedInclude;
}

function mergeWhereOptions(currentWhere, scopeWhere) {
  const mergedWhere = {};

  const currentKeys = Object.keys(currentWhere || {});
  for (let i = 0; i < currentKeys.length; i++) {
    const key = currentKeys[i];
    mergedWhere[key] = currentWhere[key];
  }

  const scopeKeys = Object.keys(scopeWhere);
  for (let i = 0; i < scopeKeys.length; i++) {
    const key = scopeKeys[i];
    mergedWhere[key] = scopeWhere[key];
  }

  return mergedWhere;
}

function mergeOtherScopeOptions(currentOptions, scopeOptions) {
  const handledKeys = ['where', 'include', 'attributes', 'order'];
  const scopeKeys = Object.keys(scopeOptions);

  for (let i = 0; i < scopeKeys.length; i++) {
    const key = scopeKeys[i];
    const isHandledKey = handledKeys.indexOf(key) !== -1;
    if (!isHandledKey) {
      currentOptions[key] = scopeOptions[key];
    }
  }
}

function mergeScopeOptions(currentOptions, scopeOptions) {
  if (scopeOptions.where) {
    currentOptions.where = mergeWhereOptions(
      currentOptions.where,
      scopeOptions.where
    );
  }

  if (scopeOptions.include) {
    currentOptions.include = mergeIncludeOptions(
      currentOptions.include,
      scopeOptions.include
    );
  }

  if (scopeOptions.attributes) {
    currentOptions.attributes = scopeOptions.attributes;
  }

  if (scopeOptions.order) {
    currentOptions.order = scopeOptions.order;
  }

  mergeOtherScopeOptions(currentOptions, scopeOptions);
}

function applyScope(scope, ...scopeArgs) {
  const req = this._req;
  const model = this._model;

  if (!model || !model.scope) {
    throw new Error('Model does not support scopes');
  }

  const scopedModel = createScopedModel(model, scope, scopeArgs);
  const scopeOptions = scopedModel._scope || {};

  ensureApializeStructure(req);

  const currentOptions = req.apialize.options;
  mergeScopeOptions(currentOptions, scopeOptions);

  return scopedModel;
}

function applyMultipleWhere(whereConditions) {
  if (!Array.isArray(whereConditions)) {
    throw new Error('whereConditions must be an array');
  }

  for (let i = 0; i < whereConditions.length; i++) {
    const whereCondition = whereConditions[i];
    applyWhere.call(this, whereCondition);
  }

  return this._req.apialize.options.where;
}

function getNewWhereConditions(existingWhere, conditionalWhere) {
  const newConditions = {};
  const conditionalKeys = Object.keys(conditionalWhere);

  for (let i = 0; i < conditionalKeys.length; i++) {
    const key = conditionalKeys[i];
    const value = conditionalWhere[key];
    const keyAlreadyExists = key in existingWhere;

    if (!keyAlreadyExists) {
      newConditions[key] = value;
    }
  }

  return newConditions;
}

function applyWhereIfNotExists(conditionalWhere) {
  const req = this._req;

  ensureApializeStructure(req);

  const existingWhere = req.apialize.options.where;
  const newConditions = getNewWhereConditions(existingWhere, conditionalWhere);
  const hasNewConditions = Object.keys(newConditions).length > 0;

  if (hasNewConditions) {
    return applyWhere.call(this, newConditions);
  }

  return existingWhere;
}

function applySingleScope(scopeConfig) {
  const scopeType = typeof scopeConfig;

  if (scopeType === 'string') {
    applyScope.call(this, scopeConfig);
    return;
  }

  if (scopeType === 'function') {
    applyScope.call(this, scopeConfig);
    return;
  }

  const isObjectWithName =
    scopeType === 'object' && scopeConfig && scopeConfig.name;
  if (isObjectWithName) {
    const scopeArgs = scopeConfig.args || [];
    const args = [];
    for (let i = 0; i < scopeArgs.length; i++) {
      args.push(scopeArgs[i]);
    }
    applyScope.call(this, scopeConfig.name, ...args);
  }
}

function applyScopes(scopes) {
  for (let i = 0; i < scopes.length; i++) {
    const scopeConfig = scopes[i];
    applySingleScope.call(this, scopeConfig);
  }
}

function removeWhere(keysToRemove) {
  const req = this._req;

  ensureApializeStructure(req);

  const keysArray = [];
  if (Array.isArray(keysToRemove)) {
    for (let i = 0; i < keysToRemove.length; i++) {
      keysArray.push(keysToRemove[i]);
    }
  } else {
    keysArray.push(keysToRemove);
  }

  const whereConditions = req.apialize.options.where;

  for (let i = 0; i < keysArray.length; i++) {
    const keyToRemove = keysArray[i];
    delete whereConditions[keyToRemove];
  }

  return whereConditions;
}

function replaceWhere(newWhere) {
  const req = this._req;

  ensureApializeStructure(req);

  req.apialize.options.where = newWhere || {};
  return req.apialize.options.where;
}

function cancel_operation(statusCode, customResponse) {
  const ctx = this._ctx;
  if (!ctx) {
    throw new Error('cancel_operation must be called on context object');
  }

  // Default statusCode to 400 if not provided
  statusCode = statusCode ?? 400;

  ctx._cancelled = true;
  ctx._cancelStatusCode = statusCode;

  if (customResponse !== undefined && customResponse !== null) {
    ctx._cancelResponse = customResponse;
  } else {
    ctx._cancelResponse = {
      success: false,
      message: 'Operation cancelled',
    };
  }

  // Mark the response so the handler knows it's a cancellation
  ctx._cancelResponse._apializeCancelled = true;
  // Attach statusCode to the response for access in the handler
  ctx._cancelResponse._cancelStatusCode = statusCode;

  return ctx._cancelResponse;
}

function createHelpers(req, model, ctx) {
  const context = {
    _req: req,
    _model: model,
    _ctx: ctx,
  };

  const helpers = {
    applyWhere: applyWhere.bind(context),
    applyMultipleWhere: applyMultipleWhere.bind(context),
    applyWhereIfNotExists: applyWhereIfNotExists.bind(context),
    removeWhere: removeWhere.bind(context),
    replaceWhere: replaceWhere.bind(context),
    cancel_operation: cancel_operation.bind(context),
  };

  if (model) {
    helpers.applyScope = applyScope.bind(context);
    helpers.applyScopes = applyScopes.bind(context);
  }

  return helpers;
}

module.exports = {
  applyWhere,
  applyScope,
  applyMultipleWhere,
  applyWhereIfNotExists,
  applyScopes,
  removeWhere,
  replaceWhere,
  cancel_operation,
  createHelpers,
};
