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
  const hasReqWithApialize = params.req && params.req.apialize;
  if (!hasReqWithApialize) {
    return;
  }

  const hasModel = params.model;
  const helpers = hasModel
    ? createHelpers(params.req, params.model)
    : createHelpers(params.req);

  const helperKeys = Object.keys(helpers);
  for (let i = 0; i < helperKeys.length; i++) {
    const key = helperKeys[i];
    params.req.apialize[key] = helpers[key];
    ctx[key] = helpers[key];
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
    return opts || {};
  }

  const result = {};
  if (opts) {
    const optionKeys = Object.keys(opts);
    for (let i = 0; i < optionKeys.length; i++) {
      const key = optionKeys[i];
      result[key] = opts[key];
    }
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
  const isInvalidRow = !row || typeof row !== 'object';
  if (isInvalidRow) {
    return row;
  }

  const noMappingNeeded = !idMapping || idMapping === 'id';
  if (noMappingNeeded) {
    return row;
  }

  const hasIdMappingProperty = Object.prototype.hasOwnProperty.call(
    row,
    idMapping
  );
  if (!hasIdMappingProperty) {
    return row;
  }

  const normalizedRow = {};
  const rowKeys = Object.keys(row);

  for (let i = 0; i < rowKeys.length; i++) {
    const key = rowKeys[i];
    normalizedRow[key] = row[key];
  }

  normalizedRow.id = row[idMapping];
  delete normalizedRow[idMapping];

  return normalizedRow;
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
      const isValidMapping = mapping.model && mapping.id_field;
      if (!isValidMapping) {
        continue;
      }

      const relatedModelName =
        mapping.model.name || mapping.model.tableName || '';
      const possibleFkNames = generatePossibleForeignKeyNames(relatedModelName);

      for (let j = 0; j < possibleFkNames.length; j++) {
        const fkName = possibleFkNames[j];
        const attributeExists = attributes[fkName];
        const notAlreadyMapped = !fkMappings[fkName];

        if (attributeExists && notAlreadyMapped) {
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

function checkIfRowHasField(rows, fkField) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isValidRow = row && typeof row === 'object';
    const hasField = isValidRow && row.hasOwnProperty(fkField);
    if (hasField) {
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

  const allFkMappings = identifyForeignKeyFields(
    modelForAssociations,
    relationIdMapping
  );
  const fkMappings = filterMappingsByExistingFields(allFkMappings, rows);

  const hasMappings = Object.keys(fkMappings).length > 0;
  if (!hasMappings) {
    return rows;
  }

  try {
    const lookupsNeeded = collectForeignKeyValues(rows, fkMappings);
    const lookupResults = await performBulkLookups(lookupsNeeded);
    const mappedRows = applyMappingsToAllRows(rows, fkMappings, lookupResults);
    return mappedRows;
  } catch (error) {
    throw new Error(`[Apialize] Foreign key mapping failed: ${error.message}`);
  }
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
  const mappingKeys = Object.keys(fkMappings);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isValidRow = row && typeof row === 'object';
    if (!isValidRow) {
      continue;
    }

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
    lookupResults[modelKey] = await performSingleModelLookup(lookup, modelKey);
  }

  return lookupResults;
}

function applyMappingToSingleField(mappedRow, fkField, mapping, lookupResults) {
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
  const isInvalidRow = !row || typeof row !== 'object';
  if (isInvalidRow) {
    return row;
  }

  const mappedRow = {};
  const rowKeys = Object.keys(row);

  for (let i = 0; i < rowKeys.length; i++) {
    const key = rowKeys[i];
    mappedRow[key] = row[key];
  }

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

async function normalizeRowsWithForeignKeys(
  rows,
  idMapping,
  relationIdMapping,
  sourceModel
) {
  if (!Array.isArray(rows)) {
    return rows;
  }

  const normalized = normalizeRows(rows, idMapping);

  const hasForeignKeyMapping =
    Array.isArray(relationIdMapping) && relationIdMapping.length > 0;
  if (hasForeignKeyMapping) {
    return await mapForeignKeyValues(
      normalized,
      relationIdMapping,
      sourceModel
    );
  }

  return normalized;
}

function extractConfigParams(config) {
  return {
    model: config && config.model,
    req: config && config.req,
    res: config && config.res,
    options: (config && config.options) || {},
    modelOptions: (config && config.modelOptions) || {},
    idMapping: (config && config.idMapping) || 'id',
    useReqOptionsTransaction: !!(config && config.useReqOptionsTransaction),
  };
}

async function setupTransaction(model, context, useReqOptionsTransaction, req) {
  if (!hasSequelize(model)) {
    return null;
  }

  const transaction = await model.sequelize.transaction();
  context.transaction = transaction;

  const shouldAddToReqOptions = useReqOptionsTransaction && req && req.apialize;
  if (shouldAddToReqOptions) {
    if (!req.apialize.options) {
      req.apialize.options = {};
    }
    req.apialize.options.transaction = transaction;
  }

  return transaction;
}

async function executePreHooks(context, options) {
  if (!options.pre) {
    return;
  }

  if (typeof options.pre === 'function') {
    context.preResult = await options.pre(context);
    return;
  }

  if (Array.isArray(options.pre)) {
    for (let i = 0; i < options.pre.length; i++) {
      const preHook = options.pre[i];
      if (typeof preHook === 'function') {
        const result = await preHook(context);
        context.preResult = result;
      }
    }
  }
}

async function executePostHooks(context, options) {
  if (!context._responseSent && options.post) {
    if (typeof options.post === 'function') {
      await options.post(context);
      return;
    }

    if (Array.isArray(options.post)) {
      for (let i = 0; i < options.post.length; i++) {
        const postHook = options.post[i];
        if (typeof postHook === 'function') {
          await postHook(context);
        }
      }
    }
  }
}

async function commitTransaction(context, transaction) {
  const shouldCommit =
    !context._rolledBack &&
    transaction &&
    typeof transaction.commit === 'function';
  if (shouldCommit) {
    await transaction.commit();
  }
}

async function rollbackOnError(transaction) {
  if (transaction && typeof transaction.rollback === 'function') {
    try {
      await transaction.rollback();
    } catch (_) {}
  }
}

async function withTransactionAndHooks(config, run) {
  const params = extractConfigParams(config);

  const context = buildContext({
    req: params.req,
    res: params.res,
    model: params.model,
    options: params.options,
    modelOptions: params.modelOptions,
    idMapping: params.idMapping,
  });

  const transaction = await setupTransaction(
    params.model,
    context,
    params.useReqOptionsTransaction,
    params.req
  );

  try {
    const shouldApplyScopes =
      params.modelOptions.scopes &&
      Array.isArray(params.modelOptions.scopes) &&
      params.model &&
      context.applyScopes;
    if (shouldApplyScopes) {
      context.applyScopes(params.modelOptions.scopes);
    }

    await executePreHooks(context, params.options);
    const result = await run(context);
    await executePostHooks(context, params.options);
    await commitTransaction(context, transaction);

    const hasPayload = typeof context.payload !== 'undefined';
    return hasPayload ? context.payload : result;
  } catch (err) {
    await rollbackOnError(transaction);
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
