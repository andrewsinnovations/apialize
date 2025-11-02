const { Op } = require('sequelize');

/**
 * Apply additional where conditions to the existing where clause.
 * New conditions will overwrite existing conditions for the same keys.
 * 
 * @param {Object} additionalWhere - The where conditions to add/merge
 * @returns {Object} The merged where clause
 */
function applyWhere(additionalWhere) {
  // 'this' refers to req.apialize when bound
  const req = this._req;
  
  if (!req || !req.apialize) {
    throw new Error('applyWhere must be called on req.apialize object');
  }

  // Ensure apialize structure exists
  if (!req.apialize.options) {
    req.apialize.options = {};
  }
  if (!req.apialize.options.where) {
    req.apialize.options.where = {};
  }

  if (!additionalWhere || typeof additionalWhere !== 'object') {
    return req.apialize.options.where;
  }

  // Simple overwrite merge - last condition wins
  Object.assign(req.apialize.options.where, additionalWhere);
  return req.apialize.options.where;
}



/**
 * Apply a Sequelize scope to the model and merge the scope's options
 * with the existing request options
 * 
 * @param {string|Function} scope - The scope name or scope function
 * @param {...any} scopeArgs - Arguments to pass to the scope function
 * @returns {Object} The scoped model instance
 */
function applyScope(scope, ...scopeArgs) {
  // 'this' refers to req.apialize when bound
  const req = this._req;
  const model = this._model;
  
  if (!model || !model.scope) {
    throw new Error('Model does not support scopes');
  }

  // Apply the scope to get a scoped model instance
  let scopedModel;
  if (typeof scope === 'function') {
    // Handle scope as a function
    scopedModel = model.scope(scope(...scopeArgs));
  } else {
    // Handle scope as a string name
    scopedModel = scopeArgs.length > 0 
      ? model.scope({ method: [scope, ...scopeArgs] })
      : model.scope(scope);
  }

  // Get the scope's options
  const scopeOptions = scopedModel._scope || {};
  
  // Ensure apialize options exist
  if (!req.apialize.options) {
    req.apialize.options = {};
  }

  // Merge scope options with existing options
  const currentOptions = req.apialize.options;
  
  // Handle where clause merging
  if (scopeOptions.where) {
    currentOptions.where = {
      ...currentOptions.where,
      ...scopeOptions.where
    };
  }

  // Handle include clause merging
  if (scopeOptions.include) {
    if (currentOptions.include) {
      currentOptions.include = Array.isArray(currentOptions.include)
        ? [...currentOptions.include, ...scopeOptions.include]
        : [currentOptions.include, ...scopeOptions.include];
    } else {
      currentOptions.include = scopeOptions.include;
    }
  }

  // Handle attributes
  if (scopeOptions.attributes) {
    currentOptions.attributes = scopeOptions.attributes;
  }

  // Handle order
  if (scopeOptions.order) {
    currentOptions.order = scopeOptions.order;
  }

  // Handle other scope options (limit, offset, etc.)
  Object.keys(scopeOptions).forEach(key => {
    if (!['where', 'include', 'attributes', 'order'].includes(key)) {
      currentOptions[key] = scopeOptions[key];
    }
  });

  return scopedModel;
}

/**
 * Apply multiple where conditions in sequence
 * 
 * @param {Array} whereConditions - Array of where condition objects
 */
function applyMultipleWhere(whereConditions) {
  if (!Array.isArray(whereConditions)) {
    throw new Error('whereConditions must be an array');
  }

  whereConditions.forEach(whereCondition => {
    applyWhere.call(this, whereCondition);
  });

  return this._req.apialize.options.where;
}

/**
 * Apply a where condition only if it doesn't already exist
 * 
 * @param {Object} conditionalWhere - The where conditions to add if not present
 */
function applyWhereIfNotExists(conditionalWhere) {
  const req = this._req;
  
  if (!req?.apialize?.options?.where) {
    return applyWhere.call(this, conditionalWhere);
  }

  const existingWhere = req.apialize.options.where;
  const filteredWhere = {};

  // Only add conditions that don't already exist
  for (const [key, value] of Object.entries(conditionalWhere)) {
    if (!(key in existingWhere)) {
      filteredWhere[key] = value;
    }
  }

  if (Object.keys(filteredWhere).length > 0) {
    return applyWhere.call(this, filteredWhere);
  }

  return existingWhere;
}

/**
 * Apply multiple scopes in sequence
 * 
 * @param {Array} scopes - Array of scope configurations
 */
function applyScopes(scopes) {
  scopes.forEach(scopeConfig => {
    if (typeof scopeConfig === 'string') {
      applyScope.call(this, scopeConfig);
    } else if (typeof scopeConfig === 'object' && scopeConfig.name) {
      applyScope.call(this, scopeConfig.name, ...(scopeConfig.args || []));
    } else if (typeof scopeConfig === 'function') {
      applyScope.call(this, scopeConfig);
    }
  });
}

/**
 * Remove specific where conditions
 * 
 * @param {Array|string} keysToRemove - Key(s) to remove from where clause
 */
function removeWhere(keysToRemove) {
  const req = this._req;
  
  if (!req?.apialize?.options?.where) {
    return {};
  }

  const keys = Array.isArray(keysToRemove) ? keysToRemove : [keysToRemove];
  const where = req.apialize.options.where;

  keys.forEach(key => {
    delete where[key];
  });

  return where;
}

/**
 * Replace the entire where clause
 * 
 * @param {Object} newWhere - The new where clause to set
 */
function replaceWhere(newWhere) {
  const req = this._req;
  
  if (!req || !req.apialize) {
    throw new Error('replaceWhere must be called on req.apialize object');
  }

  if (!req.apialize.options) {
    req.apialize.options = {};
  }

  req.apialize.options.where = newWhere || {};
  return req.apialize.options.where;
}

/**
 * Create helper functions bound to a specific request and model
 * 
 * @param {Object} req - The Express request object
 * @param {Object} model - The Sequelize model (optional, for scope functions)
 * @returns {Object} Object with bound helper functions
 */
function createHelpers(req, model = null) {
  const context = {
    _req: req,
    _model: model
  };

  const helpers = {
    applyWhere: applyWhere.bind(context),
    applyMultipleWhere: applyMultipleWhere.bind(context),
    applyWhereIfNotExists: applyWhereIfNotExists.bind(context),
    removeWhere: removeWhere.bind(context),
    replaceWhere: replaceWhere.bind(context)
  };

  // Only add scope-related functions if model is available
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
  createHelpers
};