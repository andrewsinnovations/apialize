const utils = require('./utils');
const { createHelpers } = require('./contextHelpers');
const defaultNotFound = utils.defaultNotFound;

function buildContext(params) {
  const ctx = {};
  ctx.req = params.req;
  ctx.request = params.req;
  ctx.res = params.res;
  ctx.model = params.model;
  ctx.options = params.options;
  ctx.modelOptions = params.modelOptions;
  ctx.apialize = params.req && params.req.apialize;
  ctx.idMapping = params.idMapping;
  ctx.transaction = null;
  ctx.preResult = undefined;
  ctx.payload = null;
  
  // Enhance req.apialize with model-aware helper functions if model is available
  if (params.model && params.req && params.req.apialize) {
    const helpers = createHelpers(params.req, params.model);
    // Update the helper functions with model support
    Object.assign(params.req.apialize, helpers);
    
    // Also add helper functions directly to context for convenience
    Object.assign(ctx, helpers);
  } else if (params.req && params.req.apialize) {
    // Add basic helpers (without model-dependent functions) to context
    const helpers = createHelpers(params.req);
    Object.assign(params.req.apialize, helpers);
    Object.assign(ctx, helpers);
  }
  
  return ctx;
}

function hasSequelize(model) {
  return !!(
    model &&
    model.sequelize &&
    typeof model.sequelize.transaction === 'function'
  );
}

function optionsWithTransaction(opts, t) {
  if (!t) {
    return opts || {};
  }
  const result = opts ? Object.assign({}, opts) : {};
  result.transaction = t;
  return result;
}

async function notFoundWithRollback(context) {
  const t = context && context.transaction;
  if (t && typeof t.rollback === 'function') {
    try {
      await t.rollback();
    } catch (_) {}
  }
  if (context) {
    context._rolledBack = true;
    context._responseSent = true;
  }
  return defaultNotFound(context.res);
}

function normalizeId(row, idMapping) {
  if (!row || typeof row !== 'object') {
    return row;
  }
  if (!idMapping || idMapping === 'id') {
    return row;
  }
  if (Object.prototype.hasOwnProperty.call(row, idMapping)) {
    const next = Object.assign({}, row);
    next.id = row[idMapping];
    delete next[idMapping];
    return next;
  }
  return row;
}

function normalizeRows(rows, idMapping) {
  if (!Array.isArray(rows)) {
    return rows;
  }
  const normalized = [];
  for (let i = 0; i < rows.length; i += 1) {
    normalized.push(normalizeId(rows[i], idMapping));
  }
  return normalized;
}

async function withTransactionAndHooks(config, run) {
  const model = config && config.model;
  const req = config && config.req;
  const res = config && config.res;
  const options = (config && config.options) || {};
  const modelOptions = (config && config.modelOptions) || {};
  const idMapping = (config && config.idMapping) || 'id';
  const useReqOptionsTransaction = !!(
    config && config.useReqOptionsTransaction
  );

  const context = buildContext({
    req: req,
    res: res,
    model: model,
    options: options,
    modelOptions: modelOptions,
    idMapping: idMapping,
  });

  let t = null;
  if (hasSequelize(model)) {
    t = await model.sequelize.transaction();
    context.transaction = t;
    if (useReqOptionsTransaction && req && req.apialize) {
      if (!req.apialize.options) {
        req.apialize.options = {};
      }
      req.apialize.options.transaction = t;
    }
  }

  try {
    // Apply scopes from modelOptions before pre-hooks run
    if (modelOptions.scopes && Array.isArray(modelOptions.scopes) && model && context.applyScopes) {
      try {
        context.applyScopes(modelOptions.scopes);
      } catch (scopeError) {
        // If scope application fails, log the error but continue execution
        console.error('[Apialize] Error applying modelOptions scopes:', scopeError);
      }
    }

    if (options.pre) {
      if (typeof options.pre === 'function') {
        context.preResult = await options.pre(context);
      } else if (Array.isArray(options.pre)) {
        for (let i = 0; i < options.pre.length; i += 1) {
          const preHook = options.pre[i];
          if (typeof preHook === 'function') {
            const result = await preHook(context);
            context.preResult = result;
          }
        }
      }
    }

  const result = await run(context);

    if (!context._responseSent && options.post) {
      if (typeof options.post === 'function') {
        await options.post(context);
      } else if (Array.isArray(options.post)) {
        for (let i = 0; i < options.post.length; i += 1) {
          const postHook = options.post[i];
          if (typeof postHook === 'function') {
            await postHook(context);
          }
        }
      }
    }

    if (!context._rolledBack && t && typeof t.commit === 'function') {
      await t.commit();
    }

    // Always return the latest payload from context when available so that
    // post hooks that replace or mutate context.payload are reflected in the
    // final response. Fall back to the original result when no payload exists.
    return typeof context.payload !== 'undefined' ? context.payload : result;
  } catch (err) {
    if (t && typeof t.rollback === 'function') {
      try {
        await t.rollback();
      } catch (_) {}
    }
    throw err;
  }
}

module.exports = {
  buildContext: buildContext,
  withTransactionAndHooks: withTransactionAndHooks,
  optionsWithTransaction: optionsWithTransaction,
  notFoundWithRollback: notFoundWithRollback,
  normalizeId: normalizeId,
  normalizeRows: normalizeRows,
};
