const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  filterMiddlewareFns,
  buildHandlers,
  getIdFromInstance,
  extractOption,
  extractBooleanOption,
  extractMiddleware,
  mergeReqOptionsIntoModelOptions,
  convertInstanceToPlainObject,
} = require('./utils');
const { validateData } = require('./validationMiddleware');
const {
  withTransactionAndHooks,
  optionsWithTransaction,
} = require('./operationUtils');

function validateBulkCreateRequest(rawBody, allow_bulk_create, context) {
  if (Array.isArray(rawBody) && !allow_bulk_create) {
    context.res
      .status(400)
      .json({ success: false, error: 'Cannot insert multiple records.' });
    return false;
  }
  return true;
}

function applyIdMapping(outputArray, id_mapping) {
  const needsIdMapping = id_mapping && id_mapping !== 'id';
  if (!needsIdMapping) {
    return;
  }

  for (let i = 0; i < outputArray.length; i++) {
    const row = outputArray[i];
    const hasRow = row && typeof row === 'object';
    const hasIdMappingProperty =
      hasRow && Object.prototype.hasOwnProperty.call(row, id_mapping);
    const idMappingValueExists =
      hasIdMappingProperty && typeof row[id_mapping] !== 'undefined';

    if (idMappingValueExists) {
      row.id = row[id_mapping];
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
  const createKeys = Object.keys(createOptions);

  for (let i = 0; i < createKeys.length; i++) {
    const key = createKeys[i];
    bulkOptions[key] = createOptions[key];
  }

  bulkOptions.returning = true;
  bulkOptions.validate = true;
  bulkOptions.individualHooks = true;

  return bulkOptions;
}

function handleBulkCreate(model, rawBody, createOptions, context, id_mapping) {
  ensureFn(model, 'bulkCreate');

  const bulkOptions = createBulkOptions(createOptions);

  return model.bulkCreate(rawBody, bulkOptions).then((createdArray) => {
    const outputArray = convertInstancesToPlainObjects(createdArray);
    applyIdMapping(outputArray, id_mapping);

    context.created = createdArray;
    context.payload = outputArray;
    return context.payload;
  });
}

function handleSingleCreate(model, req, createOptions, context, id_mapping) {
  const values = req && req.apialize ? req.apialize.values : undefined;

  return model.create(values, createOptions).then((created) => {
    context.created = created;
    const idValue = getIdFromInstance(created, id_mapping);
    context.payload = { success: true, id: idValue };
    return context.payload;
  });
}

function getDataToValidate(rawBody, req) {
  const isBulkOperation = Array.isArray(rawBody);
  if (isBulkOperation) {
    return rawBody;
  }

  const hasProcessedValues = req && req.apialize && req.apialize.values;
  if (hasProcessedValues) {
    return req.apialize.values;
  }

  return rawBody;
}

function handleValidationError(error, context) {
  const isValidationError = error.name === 'ValidationError';
  if (isValidationError) {
    context.res.status(400).json({
      success: false,
      error: error.message,
      details: error.details,
    });
    return false;
  }
  throw error;
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

function buildEffectiveOptions(options, pre, post) {
  const effectiveOptions = {};
  const optionKeys = Object.keys(options);

  for (let i = 0; i < optionKeys.length; i++) {
    const key = optionKeys[i];
    effectiveOptions[key] = options[key];
  }

  if (pre !== null) {
    effectiveOptions.pre = pre;
  }

  if (post !== null) {
    effectiveOptions.post = post;
  }

  return effectiveOptions;
}

async function executeCreateOperation(
  model,
  req,
  rawBody,
  createOptions,
  context,
  id_mapping
) {
  const isBulkOperation = Array.isArray(rawBody);

  if (isBulkOperation) {
    return await handleBulkCreate(
      model,
      rawBody,
      createOptions,
      context,
      id_mapping
    );
  }

  return await handleSingleCreate(
    model,
    req,
    createOptions,
    context,
    id_mapping
  );
}

async function processCreateRequest(
  model,
  options,
  modelOptions,
  req,
  res,
  config
) {
  const effectiveOptions = buildEffectiveOptions(
    options,
    config.pre,
    config.post
  );

  return await withTransactionAndHooks(
    {
      model: model,
      options: effectiveOptions,
      req: req,
      res: res,
      modelOptions: modelOptions,
      idMapping: config.id_mapping,
    },
    async function (context) {
      const rawBody = req && req.body;

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
          model,
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
        modelOptions
      );
      const createOptions = optionsWithTransaction(
        mergedCreateOptions,
        context.transaction
      );

      return await executeCreateOperation(
        model,
        req,
        rawBody,
        createOptions,
        context,
        config.id_mapping
      );
    }
  );
}

function create(model, options, modelOptions) {
  const safeOptions = options || {};
  const safeModelOptions = modelOptions || {};

  ensureFn(model, 'create');

  const middleware = extractMiddleware(safeOptions);
  const allow_bulk_create = extractBooleanOption(
    safeOptions,
    'allow_bulk_create',
    false
  );
  const validate = extractBooleanOption(safeOptions, 'validate', true);
  const id_mapping = extractOption(safeOptions, 'id_mapping', 'id');
  const pre = extractOption(safeOptions, 'pre', null);
  const post = extractOption(safeOptions, 'post', null);

  const inline = filterMiddlewareFns(middleware);
  const router = express.Router({ mergeParams: true });

  const handlers = buildHandlers(inline, async (req, res) => {
    const payload = await processCreateRequest(
      model,
      safeOptions,
      safeModelOptions,
      req,
      res,
      {
        pre: pre,
        post: post,
        allow_bulk_create: allow_bulk_create,
        validate: validate,
        id_mapping: id_mapping,
      }
    );

    const responseNotSent = !res.headersSent;
    if (responseNotSent) {
      res.status(201).json(payload);
    }
  });

  router.post('/', handlers);

  router.apialize = {};
  return router;
}

module.exports = create;
