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
    return model.scope(scope(...scopeArgs));
  }

  if (scopeArgs.length > 0) {
    return model.scope({ method: [scope, ...scopeArgs] });
  }

  return model.scope(scope);
}

function mergeIncludeOptions(currentInclude, scopeInclude) {
  if (currentInclude) {
    if (Array.isArray(currentInclude)) {
      return [...currentInclude, ...scopeInclude];
    }
    return [currentInclude, ...scopeInclude];
  }
  return scopeInclude;
}

function mergeScopeOptions(currentOptions, scopeOptions) {
  if (scopeOptions.where) {
    currentOptions.where = {
      ...currentOptions.where,
      ...scopeOptions.where,
    };
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

  const handledKeys = ['where', 'include', 'attributes', 'order'];
  const otherScopeKeys = Object.keys(scopeOptions);

  for (let i = 0; i < otherScopeKeys.length; i++) {
    const key = otherScopeKeys[i];
    if (!handledKeys.includes(key)) {
      currentOptions[key] = scopeOptions[key];
    }
  }
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

function applyWhereIfNotExists(conditionalWhere) {
  const req = this._req;

  ensureApializeStructure(req);

  const existingWhere = req.apialize.options.where;
  const filteredWhere = {};

  const conditionalKeys = Object.keys(conditionalWhere);
  for (let i = 0; i < conditionalKeys.length; i++) {
    const key = conditionalKeys[i];
    const value = conditionalWhere[key];
    if (!(key in existingWhere)) {
      filteredWhere[key] = value;
    }
  }

  if (Object.keys(filteredWhere).length > 0) {
    return applyWhere.call(this, filteredWhere);
  }

  return existingWhere;
}

function applyScopes(scopes) {
  for (let i = 0; i < scopes.length; i++) {
    const scopeConfig = scopes[i];

    if (typeof scopeConfig === 'string') {
      applyScope.call(this, scopeConfig);
    } else if (typeof scopeConfig === 'object' && scopeConfig.name) {
      const scopeArgs = scopeConfig.args || [];
      applyScope.call(this, scopeConfig.name, ...scopeArgs);
    } else if (typeof scopeConfig === 'function') {
      applyScope.call(this, scopeConfig);
    }
  }
}

function removeWhere(keysToRemove) {
  const req = this._req;

  ensureApializeStructure(req);

  const keys = Array.isArray(keysToRemove) ? keysToRemove : [keysToRemove];
  const where = req.apialize.options.where;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    delete where[key];
  }

  return where;
}

function replaceWhere(newWhere) {
  const req = this._req;

  ensureApializeStructure(req);

  req.apialize.options.where = newWhere || {};
  return req.apialize.options.where;
}

function createHelpers(req, model) {
  const context = {
    _req: req,
    _model: model,
  };

  const helpers = {
    applyWhere: applyWhere.bind(context),
    applyMultipleWhere: applyMultipleWhere.bind(context),
    applyWhereIfNotExists: applyWhereIfNotExists.bind(context),
    removeWhere: removeWhere.bind(context),
    replaceWhere: replaceWhere.bind(context),
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
  createHelpers,
};
