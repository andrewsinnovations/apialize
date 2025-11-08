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
const { optionsWithTransaction } = require('../operationUtils');

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
 * Applies ID mapping to output array
 */
function applyIdMapping(outputArray, idMapping) {
  const needsIdMapping = idMapping && idMapping !== 'id';
  if (!needsIdMapping) {
    return;
  }

  for (let i = 0; i < outputArray.length; i++) {
    const row = outputArray[i];
    const canApplyMapping = row && typeof row === 'object' && row[idMapping];

    if (canApplyMapping) {
      row.id = row[idMapping];
    }
  }
}

function convertInstancesToPlainObjects(createdArray) {
  const outputArray = [];

  for (let i = 0; i < createdArray.length; i++) {
    const instance = createdArray[i];
    const plainObject = convertInstanceToPlainObject(instance);
    outputArray.push(plainObject);
  }

  return outputArray;
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
    const outputArray = convertInstancesToPlainObjects(createdArray);
    applyIdMapping(outputArray, idMapping);

    context.created = createdArray;
    context.payload = outputArray;
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
  const hasProcessedValues = processedValues !== undefined && processedValues !== null && Object.keys(processedValues || {}).length > 0;
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
