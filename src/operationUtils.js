const utils = require('./utils');
const { createHelpers } = require('./contextHelpers');
const defaultNotFound = utils.defaultNotFound;

function createBaseContext(params) {
  const ctx = {};
  ctx.req = params.req;
  ctx.request = params.req;
  ctx.res = params.res;
  ctx.model = params.model;
  ctx.options = params.options;
  ctx.modelOptions = params.modelOptions;
  ctx.idMapping = params.idMapping;
  ctx.transaction = null;
  ctx.preResult = undefined;
  ctx.payload = null;

  if (params.req && params.req.apialize) {
    ctx.apialize = params.req.apialize;
  }

  return ctx;
}

function addHelpersToContext(ctx, params) {
  if (params.model && params.req && params.req.apialize) {
    const helpers = createHelpers(params.req, params.model);
    Object.assign(params.req.apialize, helpers);
    Object.assign(ctx, helpers);
  } else if (params.req && params.req.apialize) {
    const helpers = createHelpers(params.req);
    Object.assign(params.req.apialize, helpers);
    Object.assign(ctx, helpers);
  }
}

function buildContext(params) {
  const ctx = createBaseContext(params);
  addHelpersToContext(ctx, params);
  return ctx;
}

function hasSequelize(model) {
  if (!model) {
    return false;
  }
  if (!model.sequelize) {
    return false;
  }
  if (typeof model.sequelize.transaction !== 'function') {
    return false;
  }
  return true;
}

function optionsWithTransaction(opts, t) {
  if (!t) {
    if (opts) {
      return opts;
    }
    return {};
  }

  let result;
  if (opts) {
    result = Object.assign({}, opts);
  } else {
    result = {};
  }

  result.transaction = t;
  return result;
}

async function rollbackTransaction(transaction) {
  if (transaction && typeof transaction.rollback === 'function') {
    try {
      await transaction.rollback();
    } catch (error) {
      // Ignore rollback errors
    }
  }
}

function markContextAsRolledBack(context) {
  if (context) {
    context._rolledBack = true;
    context._responseSent = true;
  }
}

async function notFoundWithRollback(context) {
  const transaction = context && context.transaction;
  await rollbackTransaction(transaction);
  markContextAsRolledBack(context);
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
  for (let i = 0; i < rows.length; i++) {
    const normalizedRow = normalizeId(rows[i], idMapping);
    normalized.push(normalizedRow);
  }
  return normalized;
}

function isValidBelongsToAssociation(association) {
  if (association.associationType !== 'BelongsTo') {
    return false;
  }
  if (!association.foreignKey) {
    return false;
  }
  if (!association.target) {
    return false;
  }
  return true;
}

function findMappingForTargetModel(relationIdMapping, targetModel) {
  for (let i = 0; i < relationIdMapping.length; i++) {
    const mapping = relationIdMapping[i];
    if (!mapping.model || !mapping.id_field) {
      continue;
    }

    if (mapping.model === targetModel) {
      return mapping;
    }
    if (mapping.model.name === targetModel.name) {
      return mapping;
    }
    if (mapping.model.tableName === targetModel.tableName) {
      return mapping;
    }
  }
  return null;
}

function processSequelizeAssociations(model, relationIdMapping, fkMappings) {
  if (!model.associations || typeof model.associations !== 'object') {
    return;
  }

  const associationNames = Object.keys(model.associations);
  for (let i = 0; i < associationNames.length; i++) {
    const associationName = associationNames[i];
    const association = model.associations[associationName];

    if (!isValidBelongsToAssociation(association)) {
      continue;
    }

    const fkField = association.foreignKey;
    const targetModel = association.target;
    const mapping = findMappingForTargetModel(relationIdMapping, targetModel);

    if (mapping) {
      fkMappings[fkField] = {
        model: mapping.model,
        id_field: mapping.id_field,
        pk_field: 'id',
        association: associationName,
      };
    }
  }
}

function identifyForeignKeyFields(model, relationIdMapping) {
  if (!model || !Array.isArray(relationIdMapping)) {
    return {};
  }

  const fkMappings = {};
  processSequelizeAssociations(model, relationIdMapping, fkMappings);

  function generatePossibleForeignKeyNames(modelName) {
    const lowerModelName = modelName.toLowerCase();
    return [
      `${lowerModelName}_id`,
      `${lowerModelName}Id`,
      `${lowerModelName}_key`,
      `${lowerModelName}Key`,
    ];
  }

  function addPatternBasedForeignKeys(model, relationIdMapping, fkMappings) {
    if (!model.rawAttributes) {
      return;
    }

    const attributes = model.rawAttributes;

    for (let i = 0; i < relationIdMapping.length; i++) {
      const mapping = relationIdMapping[i];
      if (!mapping.model || !mapping.id_field) {
        continue;
      }

      const relatedModelName =
        mapping.model.name || mapping.model.tableName || '';
      const possibleFkNames = generatePossibleForeignKeyNames(relatedModelName);

      for (let j = 0; j < possibleFkNames.length; j++) {
        const fkName = possibleFkNames[j];
        if (attributes[fkName] && !fkMappings[fkName]) {
          fkMappings[fkName] = {
            model: mapping.model,
            id_field: mapping.id_field,
            pk_field: 'id',
            association: null,
          };
        }
      }
    }
  }

  addPatternBasedForeignKeys(model, relationIdMapping, fkMappings);
  return fkMappings;
}

function isValidMappingInput(rows, relationIdMapping) {
  if (!Array.isArray(rows)) {
    return false;
  }
  if (!Array.isArray(relationIdMapping)) {
    return false;
  }
  if (relationIdMapping.length === 0) {
    return false;
  }
  return true;
}

function getModelForAssociations(sourceModel, relationIdMapping) {
  if (sourceModel) {
    return sourceModel;
  }

  for (let i = 0; i < relationIdMapping.length; i++) {
    const mapping = relationIdMapping[i];
    if (mapping.model) {
      return mapping.model;
    }
  }
  return null;
}

async function mapForeignKeyValues(rows, relationIdMapping, sourceModel) {
  if (!isValidMappingInput(rows, relationIdMapping)) {
    return rows;
  }

  const modelForAssociations = getModelForAssociations(
    sourceModel,
    relationIdMapping
  );
  if (!modelForAssociations) {
    return rows;
  }

  function checkIfRowHasField(rows, fkField) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row && typeof row === 'object' && row.hasOwnProperty(fkField)) {
        return true;
      }
    }
    return false;
  }

  function filterMappingsByExistingFields(allFkMappings, rows) {
    const fkMappings = {};
    const mappingKeys = Object.keys(allFkMappings);

    for (let i = 0; i < mappingKeys.length; i++) {
      const fkField = mappingKeys[i];
      const mapping = allFkMappings[fkField];

      if (checkIfRowHasField(rows, fkField)) {
        fkMappings[fkField] = mapping;
      }
    }

    return fkMappings;
  }

  const allFkMappings = identifyForeignKeyFields(
    modelForAssociations,
    relationIdMapping
  );
  const fkMappings = filterMappingsByExistingFields(allFkMappings, rows);

  if (Object.keys(fkMappings).length === 0) {
    return rows;
  }

  function getModelKey(mapping) {
    return mapping.model.name || mapping.model.tableName;
  }

  function initializeLookupEntry(mapping) {
    return {
      model: mapping.model,
      id_field: mapping.id_field,
      pk_field: mapping.pk_field,
      values: new Set(),
    };
  }

  function collectForeignKeyValues(rows, fkMappings) {
    const lookupsNeeded = {};

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== 'object') {
        continue;
      }

      const mappingKeys = Object.keys(fkMappings);
      for (let j = 0; j < mappingKeys.length; j++) {
        const fkField = mappingKeys[j];
        const mapping = fkMappings[fkField];

        if (row[fkField] != null) {
          const modelKey = getModelKey(mapping);
          if (!lookupsNeeded[modelKey]) {
            lookupsNeeded[modelKey] = initializeLookupEntry(mapping);
          }
          lookupsNeeded[modelKey].values.add(row[fkField]);
        }
      }
    }

    return lookupsNeeded;
  }

  try {
    const lookupsNeeded = collectForeignKeyValues(rows, fkMappings);

    function getSequelizeOperator(model) {
      if (model.sequelize?.constructor?.Op) {
        return model.sequelize.constructor.Op;
      }
      if (model.sequelize?.Sequelize?.Op) {
        return model.sequelize.Sequelize.Op;
      }
      return require('sequelize').Op;
    }

    function createIdMapping(records, pkField, idField) {
      const mapping = {};
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        mapping[record[pkField]] = record[idField];
      }
      return mapping;
    }

    async function performSingleModelLookup(lookup, modelKey) {
      const values = Array.from(lookup.values);
      if (values.length === 0) {
        return {};
      }

      try {
        const Op = getSequelizeOperator(lookup.model);
        const records = await lookup.model.findAll({
          where: {
            [lookup.pk_field]: { [Op.in]: values },
          },
          attributes: [lookup.pk_field, lookup.id_field],
          raw: true,
        });

        return createIdMapping(records, lookup.pk_field, lookup.id_field);
      } catch (lookupError) {
        throw new Error(
          `[Apialize] Failed to lookup external IDs for ${modelKey}: ${lookupError.message}`
        );
      }
    }

    async function performBulkLookups(lookupsNeeded) {
      const lookupResults = {};
      const modelKeys = Object.keys(lookupsNeeded);

      for (let i = 0; i < modelKeys.length; i++) {
        const modelKey = modelKeys[i];
        const lookup = lookupsNeeded[modelKey];
        lookupResults[modelKey] = await performSingleModelLookup(
          lookup,
          modelKey
        );
      }

      return lookupResults;
    }

    const lookupResults = await performBulkLookups(lookupsNeeded);

    function applyMappingToSingleField(
      mappedRow,
      fkField,
      mapping,
      lookupResults
    ) {
      if (mappedRow[fkField] == null) {
        return;
      }

      const modelKey = mapping.model.name || mapping.model.tableName;
      const lookupMap = lookupResults[modelKey] || {};
      const externalId = lookupMap[mappedRow[fkField]];

      if (externalId != null) {
        mappedRow[fkField] = externalId;
      }
    }

    function applyAllMappingsToRow(row, fkMappings, lookupResults) {
      if (!row || typeof row !== 'object') {
        return row;
      }

      const mappedRow = Object.assign({}, row);
      const mappingKeys = Object.keys(fkMappings);

      for (let i = 0; i < mappingKeys.length; i++) {
        const fkField = mappingKeys[i];
        const mapping = fkMappings[fkField];
        applyMappingToSingleField(mappedRow, fkField, mapping, lookupResults);
      }

      return mappedRow;
    }

    function applyMappingsToAllRows(rows, fkMappings, lookupResults) {
      const mappedRows = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const mappedRow = applyAllMappingsToRow(row, fkMappings, lookupResults);
        mappedRows.push(mappedRow);
      }

      return mappedRows;
    }

    const mappedRows = applyMappingsToAllRows(rows, fkMappings, lookupResults);
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
