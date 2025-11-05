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

// Helper function to identify foreign key fields using Sequelize associations
function identifyForeignKeyFields(model, relationIdMapping) {
  if (!model || !Array.isArray(relationIdMapping)) {
    return {};
  }

  const fkMappings = {};

  // First try to use Sequelize associations (more accurate)
  if (model.associations && typeof model.associations === 'object') {
    for (const [associationName, association] of Object.entries(
      model.associations
    )) {
      // Only look at BelongsTo associations since they define foreign keys on this model
      if (
        association.associationType === 'BelongsTo' &&
        association.foreignKey &&
        association.target
      ) {
        const fkField = association.foreignKey;
        const targetModel = association.target;

        // Find matching relation_id_mapping for this target model
        const mapping = relationIdMapping.find((m) => {
          if (!m.model || !m.id_field) return false;
          // Compare by reference, name, or tableName
          return (
            m.model === targetModel ||
            m.model.name === targetModel.name ||
            m.model.tableName === targetModel.tableName
          );
        });

        if (mapping) {
          fkMappings[fkField] = {
            model: mapping.model,
            id_field: mapping.id_field,
            pk_field: 'id', // Assume primary key is 'id' for lookups
            association: associationName,
          };
        }
      }
    }
  }

  // Add pattern-based detection for any unmapped relations (in addition to association-based)
  if (model.rawAttributes) {
    const attributes = model.rawAttributes;

    for (const mapping of relationIdMapping) {
      if (!mapping.model || !mapping.id_field) continue;

      const relatedModelName =
        mapping.model.name || mapping.model.tableName || '';
      const lowerModelName = relatedModelName.toLowerCase();

      // Check for common foreign key patterns: model_id, modelId, model_key, etc.
      const possibleFkNames = [
        `${lowerModelName}_id`,
        `${lowerModelName}Id`,
        `${lowerModelName}_key`,
        `${lowerModelName}Key`,
      ];

      for (const fkName of possibleFkNames) {
        if (attributes[fkName] && !fkMappings[fkName]) {
          fkMappings[fkName] = {
            model: mapping.model,
            id_field: mapping.id_field,
            pk_field: 'id',
            association: null, // No association found, using pattern matching
          };
        }
      }
    }
  }

  return fkMappings;
}

// Async function to replace foreign key values with external IDs
async function mapForeignKeyValues(rows, relationIdMapping, sourceModel) {
  if (
    !Array.isArray(rows) ||
    !Array.isArray(relationIdMapping) ||
    relationIdMapping.length === 0
  ) {
    return rows;
  }

  // Use the source model if provided, otherwise fall back to first mapping model
  let modelForAssociations = sourceModel;
  if (!modelForAssociations) {
    const firstMapping = relationIdMapping.find((m) => m.model);
    if (!firstMapping || !firstMapping.model) {
      return rows;
    }
    modelForAssociations = firstMapping.model;
  }

  // Get foreign key mappings using association-aware detection
  const allFkMappings = identifyForeignKeyFields(
    modelForAssociations,
    relationIdMapping
  );

  // Filter to only include fields that actually exist in the data
  const fkMappings = {};
  for (const [fkField, mapping] of Object.entries(allFkMappings)) {
    // Check if any row has this field
    const hasField = rows.some(
      (row) => row && typeof row === 'object' && row.hasOwnProperty(fkField)
    );
    if (hasField) {
      fkMappings[fkField] = mapping;
    }
  }

  // If no foreign keys to map, return original rows
  if (Object.keys(fkMappings).length === 0) {
    return rows;
  }

  try {
    // Create a map of lookups we need to perform
    const lookupsNeeded = {};

    // Collect all unique foreign key values that need mapping
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;

      for (const [fkField, mapping] of Object.entries(fkMappings)) {
        if (row[fkField] != null) {
          const modelKey = mapping.model.name || mapping.model.tableName;
          if (!lookupsNeeded[modelKey]) {
            lookupsNeeded[modelKey] = {
              model: mapping.model,
              id_field: mapping.id_field,
              pk_field: mapping.pk_field,
              values: new Set(),
            };
          }
          lookupsNeeded[modelKey].values.add(row[fkField]);
        }
      }
    }

    // Perform bulk lookups for each model
    const lookupResults = {};
    for (const [modelKey, lookup] of Object.entries(lookupsNeeded)) {
      const values = Array.from(lookup.values);
      if (values.length === 0) continue;

      try {
        // Use the Op from the model's Sequelize instance
        const Op =
          lookup.model.sequelize?.constructor?.Op ||
          lookup.model.sequelize?.Sequelize?.Op ||
          require('sequelize').Op;

        const records = await lookup.model.findAll({
          where: {
            [lookup.pk_field]: { [Op.in]: values },
          },
          attributes: [lookup.pk_field, lookup.id_field],
          raw: true,
        });

        // Create mapping from internal ID to external ID
        lookupResults[modelKey] = {};
        for (const record of records) {
          lookupResults[modelKey][record[lookup.pk_field]] =
            record[lookup.id_field];
        }
      } catch (lookupError) {
        throw new Error(
          `[Apialize] Failed to lookup external IDs for ${modelKey}: ${lookupError.message}`
        );
      }
    }

    // Apply mappings to rows
    const mappedRows = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        mappedRows.push(row);
        continue;
      }

      const mappedRow = { ...row };

      for (const [fkField, mapping] of Object.entries(fkMappings)) {
        if (mappedRow[fkField] != null) {
          const modelKey = mapping.model.name || mapping.model.tableName;
          const lookupMap = lookupResults[modelKey] || {};
          const externalId = lookupMap[mappedRow[fkField]];

          if (externalId != null) {
            mappedRow[fkField] = externalId;
          }
          // If no external ID found, keep the original value
        }
      }

      mappedRows.push(mappedRow);
    }

    return mappedRows;
  } catch (error) {
    throw new Error(`[Apialize] Foreign key mapping failed: ${error.message}`);
  }
}

// Enhanced normalizeRows that supports foreign key mapping
async function normalizeRowsWithForeignKeys(
  rows,
  idMapping,
  relationIdMapping,
  sourceModel
) {
  if (!Array.isArray(rows)) {
    return rows;
  }

  // First apply standard ID normalization
  const normalized = normalizeRows(rows, idMapping);

  // Then apply foreign key mapping if configured
  if (Array.isArray(relationIdMapping) && relationIdMapping.length > 0) {
    return await mapForeignKeyValues(
      normalized,
      relationIdMapping,
      sourceModel
    );
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
    if (
      modelOptions.scopes &&
      Array.isArray(modelOptions.scopes) &&
      model &&
      context.applyScopes
    ) {
      context.applyScopes(modelOptions.scopes);
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
  normalizeRowsWithForeignKeys: normalizeRowsWithForeignKeys,
};
