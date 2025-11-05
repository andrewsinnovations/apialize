const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  filterMiddlewareFns,
  buildHandlers,
  buildHandlersWithValidation,
  getIdFromInstance,
  extractOption,
  extractBooleanOption,
  extractMiddleware,
  mergeReqOptionsIntoModelOptions,
  convertInstanceToPlainObject,
} = require('./utils');
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
  if (id_mapping && id_mapping !== 'id') {
    for (let i = 0; i < outputArray.length; i++) {
      const row = outputArray[i];
      if (
        row &&
        Object.prototype.hasOwnProperty.call(row, id_mapping) &&
        typeof row[id_mapping] !== 'undefined'
      ) {
        row.id = row[id_mapping];
      }
    }
  }
}

function handleBulkCreate(model, rawBody, createOptions, context, id_mapping) {
  ensureFn(model, 'bulkCreate');

  const bulkOptions = Object.assign({}, createOptions, {
    returning: true,
    validate: true,
    individualHooks: true,
  });

  return model.bulkCreate(rawBody, bulkOptions).then((createdArray) => {
    const outputArray = [];
    for (let i = 0; i < createdArray.length; i++) {
      const instance = createdArray[i];
      const plainObject = convertInstanceToPlainObject(instance);
      outputArray.push(plainObject);
    }

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

function create(model, options, modelOptions) {
  if (!options) {
    options = {};
  }
  if (!modelOptions) {
    modelOptions = {};
  }

  ensureFn(model, 'create');

  const middleware = extractMiddleware(options);
  const allow_bulk_create = extractBooleanOption(
    options,
    'allow_bulk_create',
    false
  );
  const validate = extractBooleanOption(options, 'validate', false);
  const id_mapping = extractOption(options, 'id_mapping', 'id');
  const pre = extractOption(options, 'pre', null);
  const post = extractOption(options, 'post', null);

  const inline = filterMiddlewareFns(middleware);

  const router = express.Router({ mergeParams: true });

  const handlers = buildHandlersWithValidation(
    inline, 
    async (req, res) => {
      const effectiveOptions = Object.assign({}, options, {
        pre: pre,
        post: post,
      });

      const payload = await withTransactionAndHooks(
      {
        model: model,
        options: effectiveOptions,
        req: req,
        res: res,
        modelOptions: modelOptions,
        idMapping: id_mapping,
      },
      async function (context) {
        const rawBody = req && req.body;
        const isValidRequest = validateBulkCreateRequest(
          rawBody,
          allow_bulk_create,
          context
        );
        if (!isValidRequest) {
          return;
        }
        const mergedCreateOptions = mergeReqOptionsIntoModelOptions(
          req,
          modelOptions
        );
        const createOptions = optionsWithTransaction(
          mergedCreateOptions,
          context.transaction
        );

        if (Array.isArray(rawBody)) {
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
    );

    if (!res.headersSent) {
      res.status(201).json(payload);
    }
  }, 
  model, 
  { validate });

  router.post('/', handlers);

  router.apialize = {};
  return router;
}

module.exports = create;
