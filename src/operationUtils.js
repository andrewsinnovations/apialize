const utils = require('./utils');
const { createHelpers } = require('./contextHelpers');
const defaultNotFound = utils.defaultNotFound;

function isValidModelOptions(modelOptions) {
  const hasModelOptions = modelOptions && typeof modelOptions === 'object';
  return hasModelOptions;
}

function convertScopeToSequelizeFormat(scope) {
  const isStringScope = typeof scope === 'string';
  if (isStringScope) {
    return scope;
  }

  const isObjectScope = scope && typeof scope === 'object' && scope.name;
  if (isObjectScope) {
    const hasArgs = scope.args;
    if (hasArgs) {
      return { method: [scope.name, ...scope.args] };
    }
    return scope.name;
  }

  return scope;
}

function convertScopesToSequelizeFormat(scopes) {
  const scopesToApply = [];

  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    const convertedScope = convertScopeToSequelizeFormat(scope);
    scopesToApply.push(convertedScope);
  }

  return scopesToApply;
}

function applyScopesToModel(effectiveModel, scopes) {
  const hasScopes = scopes && Array.isArray(scopes);
  if (!hasScopes) {
    return effectiveModel;
  }

  try {
    const scopesToApply = convertScopesToSequelizeFormat(scopes);
    return effectiveModel.scope(scopesToApply);
  } catch (error) {
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (isDevelopment) {
      console.warn(
        `[Apialize] Failed to apply scopes ${JSON.stringify(scopes)}: ${error.message}`
      );
    }
    throw error;
  }
}

function applySchemaToModel(effectiveModel, schema) {
  const hasSchema = schema && typeof schema === 'string';
  if (!hasSchema) {
    return effectiveModel;
  }

  try {
    return effectiveModel.schema(schema);
  } catch (error) {
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (isDevelopment) {
      console.warn(
        `[Apialize] Failed to apply schema '${schema}': ${error.message}`
      );
    }
    return effectiveModel;
  }
}

function applyEndpointConfiguration(model, modelOptions) {
  const hasValidOptions = isValidModelOptions(modelOptions);
  if (!hasValidOptions) {
    return model;
  }

  let effectiveModel = model;
  effectiveModel = applyScopesToModel(effectiveModel, modelOptions.scopes);
  effectiveModel = applySchemaToModel(effectiveModel, modelOptions.schema);

  // Preserve apialize configuration from original model
  if (model.apialize && !effectiveModel.apialize) {
    effectiveModel.apialize = model.apialize;
  }

  return effectiveModel;
}

function createBaseContext(params) {
  const ctx = {};
  ctx.req = params.req;
  ctx.request = params.req;
  ctx.res = params.res;
  ctx.model = params.model;
  ctx.options = params.options;
  ctx.modelOptions = params.modelOptions;
  ctx.idMapping = params.idMapping;
  // For read-only operations executed via withHooksOnly, tests expect transaction to be undefined.
  // It will be populated (non-undefined) explicitly when a real Sequelize transaction starts.
  ctx.transaction = undefined;
  ctx.preResult = undefined;
  ctx.payload = null;

  const hasApializeContext = params.req && params.req.apialize;
  if (hasApializeContext) {
    ctx.apialize = params.req.apialize;
  }

  return ctx;
}

function createContextHelpers(req, model, ctx) {
  const hasModel = model;
  if (hasModel) {
    return createHelpers(req, model, ctx);
  }
  return createHelpers(req, undefined, ctx);
}

function attachHelpersToObjects(helpers, req, ctx) {
  const helperKeys = Object.keys(helpers);

  for (let i = 0; i < helperKeys.length; i++) {
    const key = helperKeys[i];
    req.apialize[key] = helpers[key];
    ctx[key] = helpers[key];
  }
}

function addHelpersToContext(ctx, params) {
  const hasReqWithApialize = params.req && params.req.apialize;
  if (!hasReqWithApialize) {
    return;
  }

  const helpers = createContextHelpers(params.req, params.model, ctx);
  attachHelpersToObjects(helpers, params.req, ctx);
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

function copyOwnProperties(sourceObject, targetObject) {
  const sourceKeys = Object.keys(sourceObject);

  for (let i = 0; i < sourceKeys.length; i++) {
    const key = sourceKeys[i];
    targetObject[key] = sourceObject[key];
  }
}

function optionsWithTransaction(opts, t) {
  const hasTransaction = t;
  if (!hasTransaction) {
    return opts || {};
  }

  const result = {};
  const hasOptions = opts;
  if (hasOptions) {
    copyOwnProperties(opts, result);
  }

  result.transaction = t;
  return result;
}

function canRollbackTransaction(transaction) {
  const hasTransaction = transaction;
  const hasRollbackMethod =
    hasTransaction && typeof transaction.rollback === 'function';
  return hasRollbackMethod;
}

async function rollbackTransaction(transaction) {
  const canRollback = canRollbackTransaction(transaction);
  if (!canRollback) {
    return;
  }

  try {
    await transaction.rollback();
  } catch (error) {
    // Intentionally ignore rollback errors
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

function isValidRowForNormalization(row) {
  const hasRow = row && typeof row === 'object';
  return hasRow;
}

function needsIdMapping(idMapping) {
  const hasIdMapping = idMapping && idMapping !== 'id';
  return hasIdMapping;
}

function rowHasIdMappingProperty(row, idMapping) {
  const hasProperty = Object.prototype.hasOwnProperty.call(row, idMapping);
  return hasProperty;
}

function normalizeId(row, idMapping) {
  const isValidRow = isValidRowForNormalization(row);
  if (!isValidRow) {
    return row;
  }

  const shouldMapId = needsIdMapping(idMapping);
  if (!shouldMapId) {
    return row;
  }

  const hasIdProperty = rowHasIdMappingProperty(row, idMapping);
  if (!hasIdProperty) {
    return row;
  }

  const normalizedRow = {};
  copyOwnProperties(row, normalizedRow);

  normalizedRow.id = row[idMapping];
  delete normalizedRow[idMapping];

  return normalizedRow;
}

function normalizeRows(rows, idMapping) {
  const isArrayOfRows = Array.isArray(rows);
  if (!isArrayOfRows) {
    return rows;
  }

  const normalized = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const normalizedRow = normalizeId(row, idMapping);
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
      const pkField = targetModel.primaryKeyAttribute || 'id';
      fkMappings[fkField] = {
        model: mapping.model,
        id_field: mapping.id_field,
        pk_field: mapping.pk_field || 'id',
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
          const pkField = mapping.model.primaryKeyAttribute || 'id';
          fkMappings[fkName] = {
            model: mapping.model,
            id_field: mapping.id_field,
            pk_field: mapping.pk_field || 'id',
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
    const lookupsNeeded = collectForeignKeyValues(rows, fkMappings, false);
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

function processRowForForeignKeys(
  row,
  mappingKeys,
  fkMappings,
  lookupsNeeded,
  includeNested
) {
  for (let j = 0; j < mappingKeys.length; j++) {
    const fkField = mappingKeys[j];
    const mapping = fkMappings[fkField];

    const fieldHasValue = row[fkField] != null;
    if (fieldHasValue) {
      const modelKey = getModelKey(mapping);
      const lookupNotInitialized = !lookupsNeeded[modelKey];
      if (lookupNotInitialized) {
        lookupsNeeded[modelKey] = initializeLookupEntry(mapping);
      }

      lookupsNeeded[modelKey].values.add(row[fkField]);
    }
  }

  // If includeNested is true, recursively process nested objects
  if (includeNested) {
    const keys = Object.keys(row);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const value = row[key];

      // Check if this is a nested object (included model)
      const isNestedObject =
        value && typeof value === 'object' && !Array.isArray(value);
      if (isNestedObject) {
        processRowForForeignKeys(
          value,
          mappingKeys,
          fkMappings,
          lookupsNeeded,
          includeNested
        );
      }
    }
  }
}

function collectForeignKeyValues(rows, fkMappings, includeNested) {
  const lookupsNeeded = {};
  const mappingKeys = Object.keys(fkMappings);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isValidRow = isValidRowForNormalization(row);
    if (!isValidRow) {
      continue;
    }

    processRowForForeignKeys(
      row,
      mappingKeys,
      fkMappings,
      lookupsNeeded,
      includeNested
    );
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
  const fieldHasValue = mappedRow[fkField] != null;
  if (!fieldHasValue) {
    return;
  }

  const modelKey = getModelKey(mapping);
  const lookupMap = lookupResults[modelKey] || {};
  const externalId = lookupMap[mappedRow[fkField]];

  const hasExternalId = externalId != null;
  if (hasExternalId) {
    mappedRow[fkField] = externalId;
  }
}

function normalizeNestedIncludedModels(
  row,
  relationIdMapping,
  fkMappings,
  lookupResults,
  includeConfig
) {
  if (!row || typeof row !== 'object') {
    return;
  }

  // Iterate through all properties looking for nested included models
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = row[key];

    // Skip null/undefined values
    if (value == null) {
      continue;
    }

    // Check if this is a nested object (included model)
    const isNestedObject = typeof value === 'object' && !Array.isArray(value);
    if (!isNestedObject) {
      continue;
    }

    // Apply foreign key mappings to nested object
    if (fkMappings && lookupResults) {
      const mappingKeys = Object.keys(fkMappings);
      for (let j = 0; j < mappingKeys.length; j++) {
        const fkField = mappingKeys[j];
        const mapping = fkMappings[fkField];
        applyMappingToSingleField(value, fkField, mapping, lookupResults);
      }
    }

    // Find the include config for this nested relation to get the model
    let nestedModel = null;
    let nestedIncludeConfig = null;
    if (includeConfig && Array.isArray(includeConfig)) {
      for (let j = 0; j < includeConfig.length; j++) {
        const inc = includeConfig[j];
        // Match by 'as' alias if present, otherwise check if it's the key name
        if ((inc.as && inc.as === key) || (!inc.as && inc.model)) {
          nestedModel = inc.model;
          nestedIncludeConfig = inc.include; // For recursive calls
          break;
        }
      }
    }

    // Check if the nested model has its own apialize.default.id_mapping
    let nestedIdMapping = null;
    if (nestedModel && nestedModel.options && nestedModel.options.apialize) {
      const apializeConfig = nestedModel.options.apialize;
      if (apializeConfig.default && apializeConfig.default.id_mapping) {
        nestedIdMapping = apializeConfig.default.id_mapping;
      }
    }

    // Apply the nested model's own id_mapping if found
    if (nestedIdMapping && nestedIdMapping !== 'id') {
      const hasIdField = value.hasOwnProperty(nestedIdMapping);
      if (hasIdField) {
        value.id = value[nestedIdMapping];
        delete value[nestedIdMapping];
      }
    } else {
      // Fall back to relation_id_mapping if no model-level config
      for (let j = 0; j < relationIdMapping.length; j++) {
        const mapping = relationIdMapping[j];
        if (!mapping.model || !mapping.id_field) {
          continue;
        }

        // If the nested object has the id_field, normalize it
        const hasIdField = value.hasOwnProperty(mapping.id_field);
        if (hasIdField && value.id !== undefined) {
          value.id = value[mapping.id_field];
          delete value[mapping.id_field];
        }
      }
    }

    // Recursively normalize any further nested objects
    normalizeNestedIncludedModels(
      value,
      relationIdMapping,
      fkMappings,
      lookupResults,
      nestedIncludeConfig
    );
  }
}

function applyAllMappingsToRow(row, fkMappings, lookupResults) {
  const isValidRow = isValidRowForNormalization(row);
  if (!isValidRow) {
    return row;
  }

  const mappedRow = {};
  copyOwnProperties(row, mappedRow);

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
  sourceModel,
  includeConfig
) {
  if (!Array.isArray(rows)) {
    return rows;
  }

  const normalized = normalizeRows(rows, idMapping);

  const hasForeignKeyMapping =
    Array.isArray(relationIdMapping) && relationIdMapping.length > 0;
  if (hasForeignKeyMapping) {
    // Get the foreign key mappings for reuse in nested objects
    const modelForAssociations = getModelForAssociations(
      sourceModel,
      relationIdMapping
    );
    const allFkMappings = modelForAssociations
      ? identifyForeignKeyFields(modelForAssociations, relationIdMapping)
      : {};
    const fkMappings = filterMappingsByExistingFields(
      allFkMappings,
      normalized
    );

    // Collect foreign key values from the ORIGINAL normalized data (before mapping)
    // This includes nested objects for the second lookup
    const lookupsNeeded = collectForeignKeyValues(normalized, fkMappings, true);
    const lookupResults =
      Object.keys(lookupsNeeded).length > 0
        ? await performBulkLookups(lookupsNeeded)
        : {};

    // Apply the mappings to transform foreign key values
    const mapped = applyMappingsToAllRows(
      normalized,
      fkMappings,
      lookupResults
    );

    // Also normalize id and foreign key fields of nested included models
    for (let i = 0; i < mapped.length; i++) {
      normalizeNestedIncludedModels(
        mapped[i],
        relationIdMapping,
        fkMappings,
        lookupResults,
        includeConfig
      );
    }

    return mapped;
  }

  // Even without foreign key mapping, we should still normalize nested models' id fields
  if (includeConfig && Array.isArray(includeConfig)) {
    for (let i = 0; i < normalized.length; i++) {
      normalizeNestedIncludedModels(
        normalized[i],
        relationIdMapping || [],
        {},
        {},
        includeConfig
      );
    }
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
    contextExtras: (config && config.contextExtras) || null,
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

async function executeSinglePreHook(preHook, context) {
  const isFunction = typeof preHook === 'function';
  if (isFunction) {
    const result = await preHook(context);
    context.preResult = result;
  }
}

async function executePreHookArray(preHooks, context) {
  for (let i = 0; i < preHooks.length; i++) {
    const preHook = preHooks[i];
    await executeSinglePreHook(preHook, context);

    // Check if operation was cancelled
    if (context._cancelled) {
      return;
    }
  }
}

async function executePreHooks(context, options) {
  const hasPreHooks = options.pre;
  if (!hasPreHooks) {
    return;
  }

  const isSingleFunction = typeof options.pre === 'function';
  if (isSingleFunction) {
    context.preResult = await options.pre(context);
    return;
  }

  const isArrayOfHooks = Array.isArray(options.pre);
  if (isArrayOfHooks) {
    await executePreHookArray(options.pre, context);
  }
}

async function executeSinglePostHook(postHook, context) {
  const isFunction = typeof postHook === 'function';
  if (isFunction) {
    await postHook(context);
  }
}

async function executePostHookArray(postHooks, context) {
  for (let i = 0; i < postHooks.length; i++) {
    const postHook = postHooks[i];
    await executeSinglePostHook(postHook, context);

    // Check if operation was cancelled
    if (context._cancelled) {
      return;
    }
  }
}

async function executePostHooks(context, options) {
  const responseNotSent = !context._responseSent;
  const hasPostHooks = options.post;

  if (!responseNotSent || !hasPostHooks) {
    return;
  }

  const isSingleFunction = typeof options.post === 'function';
  if (isSingleFunction) {
    await options.post(context);
    return;
  }

  const isArrayOfHooks = Array.isArray(options.post);
  if (isArrayOfHooks) {
    await executePostHookArray(options.post, context);
  }
}

function canCommitTransaction(context, transaction) {
  const notRolledBack = !context._rolledBack;
  const hasTransaction = transaction;
  const hasCommitMethod =
    hasTransaction && typeof transaction.commit === 'function';

  return notRolledBack && hasCommitMethod;
}

async function commitTransaction(context, transaction) {
  const shouldCommit = canCommitTransaction(context, transaction);
  if (shouldCommit) {
    await transaction.commit();
  }
}

async function rollbackOnError(transaction) {
  const canRollback = canRollbackTransaction(transaction);
  if (!canRollback) {
    return;
  }

  try {
    await transaction.rollback();
  } catch (error) {
    // Intentionally ignore rollback errors during error handling
  }
}

function determineReturnValue(context, result) {
  const hasPayload = typeof context.payload !== 'undefined';
  if (hasPayload) {
    return context.payload;
  }
  return result;
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

  // Apply any additional context properties (e.g., for destroy operations)
  if (params.contextExtras) {
    Object.assign(context, params.contextExtras);
  }

  const transaction = await setupTransaction(
    params.model,
    context,
    params.useReqOptionsTransaction,
    params.req
  );

  try {
    await executePreHooks(context, params.options);

    // If cancelled during pre hooks, rollback and return cancel response
    // But only if the user hasn't already sent a response manually
    if (context._cancelled && !context._responseSent) {
      await rollbackTransaction(transaction);
      markContextAsRolledBack(context);
      return context._cancelResponse;
    }

    // If response was already sent manually, skip the operation
    if (context._responseSent) {
      await rollbackTransaction(transaction);
      markContextAsRolledBack(context);
      return undefined;
    }

    const result = await run(context);
    await executePostHooks(context, params.options);

    // If cancelled during post hooks, rollback and return cancel response
    if (context._cancelled && !context._responseSent) {
      await rollbackTransaction(transaction);
      markContextAsRolledBack(context);
      return context._cancelResponse;
    }

    await commitTransaction(context, transaction);

    return determineReturnValue(context, result);
  } catch (err) {
    await rollbackOnError(transaction);
    throw err;
  }
}

async function withHooksOnly(config, run) {
  const params = extractConfigParams(config);

  const context = buildContext({
    req: params.req,
    res: params.res,
    model: params.model,
    options: params.options,
    modelOptions: params.modelOptions,
    idMapping: params.idMapping,
  });

  // Apply any additional context properties (e.g., for destroy operations)
  if (params.contextExtras) {
    Object.assign(context, params.contextExtras);
  }

  try {
    await executePreHooks(context, params.options);

    // If cancelled during pre hooks, return cancel response
    // But only if the user hasn't already sent a response manually
    if (context._cancelled && !context._responseSent) {
      context._responseSent = true;
      return context._cancelResponse;
    }

    // If response was already sent manually, skip the operation
    if (context._responseSent) {
      return undefined;
    }

    const result = await run(context);
    // If the processor didn't explicitly populate context.payload, attach the result
    // so post hooks can safely mutate the payload (parity with transactional path).
    if (typeof context.payload === 'undefined' || context.payload === null) {
      context.payload = result;
    }
    await executePostHooks(context, params.options);

    // If cancelled during post hooks, return cancel response
    if (context._cancelled && !context._responseSent) {
      context._responseSent = true;
      return context._cancelResponse;
    }

    // Return the (possibly mutated) payload
    return context.payload;
  } catch (error) {
    throw error;
  }
}

/**
 * Finds the relation_id_mapping configuration for a given model
 */
function findRelationMapping(relationIdMapping, targetModel) {
  if (!Array.isArray(relationIdMapping)) {
    return null;
  }

  return relationIdMapping.find((mapping) => {
    if (mapping.model === targetModel) {
      return true;
    }

    if (mapping.model && targetModel) {
      if (mapping.model.name === targetModel.name) {
        return true;
      }
      if (mapping.model.tableName === targetModel.tableName) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Checks if a field is a foreign key and has relation_id_mapping configured
 * Returns mapping info if found, null otherwise
 */
function findForeignKeyMapping(fieldName, model, relationIdMapping) {
  if (!Array.isArray(relationIdMapping) || !model || !model.associations) {
    return null;
  }

  const associationNames = Object.keys(model.associations);
  for (let i = 0; i < associationNames.length; i++) {
    const association = model.associations[associationNames[i]];

    if (
      association.associationType === 'BelongsTo' &&
      association.foreignKey === fieldName
    ) {
      const targetModel = association.target;
      const mapping = findRelationMapping(relationIdMapping, targetModel);

      if (mapping && mapping.id_field) {
        return {
          targetModel: targetModel,
          idField: mapping.id_field,
          association: association,
        };
      }
    }
  }

  return null;
}

/**
 * Looks up the internal ID for a related model using the external ID
 */
async function lookupInternalId(
  targetModel,
  externalIdField,
  externalIdValue,
  transaction
) {
  const findOptions = {
    where: { [externalIdField]: externalIdValue },
    attributes: ['id'],
  };

  if (transaction) {
    findOptions.transaction = transaction;
  }

  const record = await targetModel.findOne(findOptions);
  return record ? record.id : null;
}

/**
 * Reverse-maps foreign key fields from external IDs to internal IDs
 * Modifies the provided object in place
 */
async function reverseMapForeignKeys(
  provided,
  model,
  relationIdMapping,
  transaction
) {
  if (!Array.isArray(relationIdMapping) || relationIdMapping.length === 0) {
    return;
  }

  const providedKeys = Object.keys(provided);
  const lookupPromises = [];

  for (let i = 0; i < providedKeys.length; i++) {
    const key = providedKeys[i];
    const value = provided[key];

    // Skip if value is null or undefined
    if (value == null) {
      continue;
    }

    const fkMapping = findForeignKeyMapping(key, model, relationIdMapping);
    if (fkMapping) {
      // Queue up the lookup
      lookupPromises.push(
        lookupInternalId(
          fkMapping.targetModel,
          fkMapping.idField,
          value,
          transaction
        ).then((internalId) => ({ key, internalId, value }))
      );
    }
  }

  if (lookupPromises.length > 0) {
    const results = await Promise.all(lookupPromises);

    for (const result of results) {
      if (result.internalId === null) {
        throw new Error(
          `Related record not found for ${result.key} = '${result.value}'`
        );
      }
      provided[result.key] = result.internalId;
    }
  }
}

/**
 * Reverse-maps foreign key fields in an array of objects (for bulk operations)
 * Modifies the provided array in place
 */
async function reverseMapForeignKeysInBulk(
  providedArray,
  model,
  relationIdMapping,
  transaction
) {
  if (!Array.isArray(providedArray) || providedArray.length === 0) {
    return;
  }

  // Process all records in parallel
  await Promise.all(
    providedArray.map((provided) =>
      reverseMapForeignKeys(provided, model, relationIdMapping, transaction)
    )
  );
}

/**
 * Extracts apialize configuration from a Sequelize model
 * @param {Object} model - Sequelize model
 * @param {String} operationType - The operation type (e.g., 'list', 'single', 'create')
 * @param {String} context - Optional context name within the operation (e.g., 'default', 'other_context')
 * @returns {Object} - Configuration object or empty object if not found
 */
function extractModelApializeConfig(model, operationType, context = 'default') {
  if (!model || !model.options || !model.options.apialize) {
    return {};
  }

  const apializeConfig = model.options.apialize;
  const config = {};

  // First, apply global default configuration if it exists
  if (apializeConfig.default && typeof apializeConfig.default === 'object') {
    Object.assign(config, apializeConfig.default);
  }

  // Then, apply operation-specific configuration if it exists
  if (apializeConfig[operationType]) {
    const operationConfig = apializeConfig[operationType];

    // If the operation config has a default, apply it
    if (
      operationConfig.default &&
      typeof operationConfig.default === 'object'
    ) {
      Object.assign(config, operationConfig.default);
    }

    // If a specific context is requested and exists, apply it
    if (
      context !== 'default' &&
      operationConfig[context] &&
      typeof operationConfig[context] === 'object'
    ) {
      Object.assign(config, operationConfig[context]);
    }
  }

  return config;
}

/**
/**
 * Extracts model_options from apialize configuration
 * @param {Object} model - Sequelize model
 * @param {String} operationType - The operation type (e.g., 'list', 'single', 'create')
 * @param {String} context - Optional context name within the operation (e.g., 'default', 'other_context')
 * @returns {Object} - model_options object or empty object if not found
 */
function extractModelApializeModelOptions(model, operationType, context = 'default') {
  if (!model || !model.options || !model.options.apialize) {
    return {};
  }

  const apializeConfig = model.options.apialize;
  const model_options = {};

  // First, apply global default model_options if it exists
  if (apializeConfig.default && apializeConfig.default.model_options && typeof apializeConfig.default.model_options === 'object') {
    Object.assign(model_options, apializeConfig.default.model_options);
  }

  // Then, apply operation-specific model_options if it exists
  if (apializeConfig[operationType]) {
    const operationConfig = apializeConfig[operationType];

    // If the operation config has a default model_options, apply it
    if (
      operationConfig.default &&
      operationConfig.default.model_options &&
      typeof operationConfig.default.model_options === 'object'
    ) {
      Object.assign(model_options, operationConfig.default.model_options);
    }

    // If a specific context is requested and exists with model_options, apply it
    if (
      context !== 'default' &&
      operationConfig[context] &&
      operationConfig[context].model_options &&
      typeof operationConfig[context].model_options === 'object'
    ) {
      Object.assign(model_options, operationConfig[context].model_options);
    }
  }

  return model_options;
}

/**
 * Merges model-based apialize configuration with user-provided options
 * Model configuration is applied first, then user options override
 * @param {Object} model - Sequelize model
 * @param {Object} userOptions - User-provided options
 * @param {String} operationType - The operation type
 * @param {String} context - Optional context name
 * @returns {Object} - Merged configuration
 */
function mergeModelAndUserOptions(
  model,
  userOptions = {},
  operationType,
  context = 'default'
) {
  const modelConfig = extractModelApializeConfig(model, operationType, context);
  const merged = {};

  // Apply model configuration first
  Object.assign(merged, modelConfig);

  // Then apply user options (these take precedence)
  Object.assign(merged, userOptions);

  return merged;
}

/**
 * Merges model-based model_options with user-provided model_options
 * Model configuration is applied first, then user options override
 * @param {Object} model - Sequelize model
 * @param {Object} userModelOptions - User-provided model_options
 * @param {String} operationType - The operation type
 * @param {String} context - Optional context name
 * @returns {Object} - Merged model_options
 */
function mergeModelAndUserModelOptions(
  model,
  userModelOptions = {},
  operationType,
  context = 'default'
) {
  const model_model_options = extractModelApializeModelOptions(model, operationType, context);
  const merged = {};

  // Apply model model_options first
  Object.assign(merged, model_model_options);

  // Then apply user model_options (these take precedence)
  Object.assign(merged, userModelOptions);

  return merged;
}

module.exports = {
  buildContext: buildContext,
  withTransactionAndHooks: withTransactionAndHooks,
  optionsWithTransaction: optionsWithTransaction,
  notFoundWithRollback: notFoundWithRollback,
  normalizeId: normalizeId,
  normalizeRows: normalizeRows,
  normalizeRowsWithForeignKeys: normalizeRowsWithForeignKeys,
  applyEndpointConfiguration: applyEndpointConfiguration,
  withHooksOnly: withHooksOnly,
  findRelationMapping: findRelationMapping,
  findForeignKeyMapping: findForeignKeyMapping,
  lookupInternalId: lookupInternalId,
  reverseMapForeignKeys: reverseMapForeignKeys,
  reverseMapForeignKeysInBulk: reverseMapForeignKeysInBulk,
  extractModelApializeConfig: extractModelApializeConfig,
  extractModelApializeModelOptions: extractModelApializeModelOptions,
  mergeModelAndUserOptions: mergeModelAndUserOptions,
  mergeModelAndUserModelOptions: mergeModelAndUserModelOptions,
};
