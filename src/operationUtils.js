const { defaultNotFound } = require("./utils");

function buildContext({ req, res, model, options, modelOptions, idMapping }) {
  return {
    req,
    request: req,
    res,
    model,
    options,
    modelOptions,
    apialize: req.apialize,
    idMapping,
    transaction: null,
    preResult: undefined,
    payload: null,
  };
}

function hasSequelize(model) {
  return !!(
    model &&
    model.sequelize &&
    typeof model.sequelize.transaction === "function"
  );
}

function optionsWithTransaction(opts, t) {
  return t ? { ...(opts || {}), transaction: t } : opts || {};
}

async function notFoundWithRollback(context) {
  const t = context && context.transaction;
  if (t && typeof t.rollback === "function") {
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
  if (!row || typeof row !== "object") return row;
  if (!idMapping || idMapping === "id") return row;
  if (Object.prototype.hasOwnProperty.call(row, idMapping)) {
    const next = { ...row, id: row[idMapping] };
    delete next[idMapping];
    return next;
  }
  return row;
}

function normalizeRows(rows, idMapping) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => normalizeId(r, idMapping));
}

async function withTransactionAndHooks(
  {
    model,
    options = {},
    req,
    res,
    modelOptions = {},
    idMapping = "id",
    useReqOptionsTransaction = false,
  },
  run,
) {
  const context = buildContext({
    req,
    res,
    model,
    options,
    modelOptions,
    idMapping,
  });
  let t = null;
  if (hasSequelize(model)) {
    t = await model.sequelize.transaction();
    context.transaction = t;
    if (useReqOptionsTransaction) {
      req.apialize.options = {
        ...(req.apialize.options || {}),
        transaction: t,
      };
    }
  }

  try {
    // Execute pre hooks
    if (options.pre) {
      if (typeof options.pre === "function") {
        context.preResult = await options.pre(context);
      } else if (Array.isArray(options.pre)) {
        for (const preHook of options.pre) {
          if (typeof preHook === "function") {
            const result = await preHook(context);
            // Store the result of the last pre hook
            context.preResult = result;
          }
        }
      }
    }

    const result = await run(context);

    // Execute post hooks
    if (!context._responseSent && options.post) {
      if (typeof options.post === "function") {
        await options.post(context);
      } else if (Array.isArray(options.post)) {
        for (const postHook of options.post) {
          if (typeof postHook === "function") {
            await postHook(context);
          }
        }
      }
    }

    if (!context._rolledBack && t && typeof t.commit === "function") {
      await t.commit();
    }

    return result;
  } catch (err) {
    if (t && typeof t.rollback === "function") {
      try {
        await t.rollback();
      } catch (_) {}
    }
    throw err;
  }
}

module.exports = {
  buildContext,
  withTransactionAndHooks,
  optionsWithTransaction,
  notFoundWithRollback,
  normalizeId,
  normalizeRows,
};
