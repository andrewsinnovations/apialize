const {
  getProvidedValues,
  getIdFromInstance,
  mergeReqOptionsIntoModelOptions,
  convertInstanceToPlainObject,
  ensureFn,
  copyOwnProperties,
  extractRequestBody,
  handleValidationError,
} = require('../utils');
const { validateData } = require('../validationMiddleware');
const {
  optionsWithTransaction,
  reverseMapForeignKeys,
  reverseMapForeignKeysInBulk,
} = require('../operationUtils');

/**
 * Validates bulk create request
 */
function validateBulkCreateRequest(rawBody, allowBulkCreate, context) {
  const isArrayRequest = Array.isArray(rawBody);
  const bulkCreateNotAllowed = !allowBulkCreate;

  if (isArrayRequest && bulkCreateNotAllowed) {
    context.res
      .status(400)
      .json({ success: false, error: 'Cannot insert multiple records.' });
    return false;
  }

  return true;
}

/**
 * Extracts IDs from created instances
 */
function extractIdsFromInstances(createdArray, idMapping) {
  const ids = [];
  const effectiveIdMapping = idMapping || 'id';

  for (let i = 0; i < createdArray.length; i++) {
    const instance = createdArray[i];
    const idValue = getIdFromInstance(instance, effectiveIdMapping);
    ids.push(idValue);
  }

  return ids;
}

function createBulkOptions(createOptions) {
  const bulkOptions = {};
  copyOwnProperties(createOptions, bulkOptions);

  bulkOptions.returning = true;
  bulkOptions.validate = true;
  bulkOptions.individualHooks = true;

  return bulkOptions;
}

function handleBulkCreate(model, rawBody, createOptions, context, idMapping) {
  ensureFn(model, 'bulkCreate');

  const bulkOptions = createBulkOptions(createOptions);

  return model.bulkCreate(rawBody, bulkOptions).then((createdArray) => {
    context.created = createdArray;
    const ids = extractIdsFromInstances(createdArray, idMapping);
    context.payload = { success: true, ids: ids };
    return context.payload;
  });
}

function handleSingleCreate(model, req, createOptions, context, idMapping) {
  const values = getProvidedValues(req);

  return model.create(values, createOptions).then((created) => {
    context.created = created;
    const idValue = getIdFromInstance(created, idMapping);
    context.payload = { success: true, id: idValue };
    return context.payload;
  });
}

function getDataToValidate(rawBody, req) {
  const isBulkOperation = Array.isArray(rawBody);
  if (isBulkOperation) {
    return rawBody;
  }
  const processedValues = getProvidedValues(req);
  const hasProcessedValues =
    processedValues !== undefined &&
    processedValues !== null &&
    Object.keys(processedValues || {}).length > 0;
  if (hasProcessedValues) {
    return processedValues;
  }

  return rawBody;
}

async function performCreateValidation(model, rawBody, req, context) {
  try {
    const dataToValidate = getDataToValidate(rawBody, req);
    await validateData(model, dataToValidate, { isPartial: false });
    return { isValid: true };
  } catch (error) {
    const wasHandled = handleValidationError(error, context);
    return { isValid: wasHandled };
  }
}

async function executeCreateOperation(
  model,
  req,
  rawBody,
  createOptions,
  context,
  idMapping
) {
  const isBulkOperation = Array.isArray(rawBody);

  if (isBulkOperation) {
    return await handleBulkCreate(
      model,
      rawBody,
      createOptions,
      context,
      idMapping
    );
  }

  return await handleSingleCreate(
    model,
    req,
    createOptions,
    context,
    idMapping
  );
}

async function processCreateRequest(context, config, req, res) {
  const rawBody = extractRequestBody(req);

  const isValidRequest = validateBulkCreateRequest(
    rawBody,
    config.allow_bulk_create,
    context
  );
  if (!isValidRequest) {
    return;
  }

  // Reverse-map foreign key fields from external IDs to internal IDs
  try {
    if (Array.isArray(rawBody)) {
      await reverseMapForeignKeysInBulk(
        rawBody,
        context.model,
        config.relation_id_mapping,
        context.transaction
      );
    } else {
      const provided = getProvidedValues(req);
      await reverseMapForeignKeys(
        provided,
        context.model,
        config.relation_id_mapping,
        context.transaction
      );
    }
  } catch (error) {
    context.res.status(400).json({
      success: false,
      error: error.message || 'Invalid foreign key reference',
    });
    return;
  }

  if (config.validate) {
    const validationResult = await performCreateValidation(
      context.model,
      rawBody,
      req,
      context
    );
    if (!validationResult.isValid) {
      return;
    }
  }

  const mergedCreateOptions = mergeReqOptionsIntoModelOptions(
    req,
    context.modelOptions
  );
  const createOptions = optionsWithTransaction(
    mergedCreateOptions,
    context.transaction
  );

  return await executeCreateOperation(
    context.model,
    req,
    rawBody,
    createOptions,
    context,
    config.id_mapping
  );
}

module.exports = {
  processCreateRequest,
};
