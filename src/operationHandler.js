const {
  express,
  apializeContext,
  ensureFn,
  filterMiddlewareFns,
  buildHandlers,
  extractOption,
  extractBooleanOption,
  extractMiddleware,
} = require('./utils');
const {
  withTransactionAndHooks,
  withHooksOnly,
  applyEndpointConfiguration,
  mergeModelAndUserOptions,
  mergeModelAndUserModelOptions,
} = require('./operationUtils');

const { processCreateRequest } = require('./operations/createProcessor');
const { processUpdateRequest } = require('./operations/updateProcessor');
const { processPatchRequest } = require('./operations/patchProcessor');
const { processDestroyRequest } = require('./operations/destroyProcessor');
const { processListRequest } = require('./operations/listProcessor');
const { processSearchRequest } = require('./operations/searchProcessor');
const { processSingleRequest } = require('./operations/singleProcessor');

const OPERATION_TYPES = {
  CREATE: 'create',
  UPDATE: 'update',
  PATCH: 'patch',
  DESTROY: 'destroy',
  LIST: 'list',
  SEARCH: 'search',
  SINGLE: 'single',
};

const OPERATION_DEFAULTS = {
  [OPERATION_TYPES.CREATE]: {
    validate: true,
    allow_bulk_create: false,
    allowed_fields: null,
    blocked_fields: null,
    id_mapping: 'id',
    middleware: [],
    pre: null,
    post: null,
    aliases: null,
  },
  [OPERATION_TYPES.UPDATE]: {
    validate: true,
    allowed_fields: null,
    blocked_fields: null,
    id_mapping: 'id',
    relation_id_mapping: null,
    middleware: [],
    pre: null,
    post: null,
    aliases: null,
  },
  [OPERATION_TYPES.PATCH]: {
    validate: true,
    allowed_fields: null,
    blocked_fields: null,
    id_mapping: 'id',
    relation_id_mapping: null,
    middleware: [],
    pre: null,
    post: null,
    aliases: null,
  },
  [OPERATION_TYPES.DESTROY]: {
    id_mapping: 'id',
    middleware: [],
    pre: null,
    post: null,
  },
  [OPERATION_TYPES.LIST]: {
    middleware: [],
    allowFiltering: true,
    allowOrdering: true,
    allowFilteringOn: null,
    blockFilteringOn: null,
    allowOrderingOn: null,
    blockOrderingOn: null,
    metaShowFilters: false,
    metaShowOrdering: false,
    defaultPageSize: 100,
    defaultOrderBy: 'id',
    defaultOrderDir: 'ASC',
    pre: null,
    post: null,
    relation_id_mapping: null,
    disableSubqueryOnIncludeRequest: true,
    flattening: null,
    aliases: null,
  },
  [OPERATION_TYPES.SEARCH]: {
    middleware: [],
    path: '/',
    allowFilteringOn: null,
    blockFilteringOn: null,
    allowOrderingOn: null,
    blockOrderingOn: null,
    metaShowOrdering: false,
    metaShowFilters: false,
    pre: null,
    post: null,
    id_mapping: 'id',
    relation_id_mapping: null,
    disableSubqueryOnIncludeRequest: true,
    flattening: null,
    defaultPageSize: 100,
    defaultOrderBy: 'id',
    defaultOrderDir: 'ASC',
    aliases: null,
  },
  [OPERATION_TYPES.SINGLE]: {
    middleware: [],
    id_mapping: 'id',
    param_name: 'id',
    pre: null,
    post: null,
    related: [],
    member_routes: [],
    flattening: null,
    relation_id_mapping: null,
    aliases: null,
  },
};

const REQUIRED_MODEL_METHODS = {
  [OPERATION_TYPES.CREATE]: ['create'],
  [OPERATION_TYPES.UPDATE]: ['update'],
  [OPERATION_TYPES.PATCH]: ['update'],
  [OPERATION_TYPES.DESTROY]: ['destroy'],
  [OPERATION_TYPES.LIST]: ['findAndCountAll'],
  [OPERATION_TYPES.SEARCH]: ['findAndCountAll'],
  [OPERATION_TYPES.SINGLE]: ['findOne'],
};

const OPERATION_PROCESSORS = {
  [OPERATION_TYPES.CREATE]: processCreateRequest,
  [OPERATION_TYPES.UPDATE]: processUpdateRequest,
  [OPERATION_TYPES.PATCH]: processPatchRequest,
  [OPERATION_TYPES.DESTROY]: processDestroyRequest,
  [OPERATION_TYPES.LIST]: processListRequest,
  [OPERATION_TYPES.SEARCH]: processSearchRequest,
  [OPERATION_TYPES.SINGLE]: processSingleRequest,
};

function validateModelForOperation(model, operationType) {
  const requiredMethods = REQUIRED_MODEL_METHODS[operationType];
  if (!requiredMethods) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  for (let i = 0; i < requiredMethods.length; i++) {
    const methodName = requiredMethods[i];
    ensureFn(model, methodName);
  }
}

function buildOperationConfig(model, options = {}, operationType) {
  const defaults = OPERATION_DEFAULTS[operationType];
  if (!defaults) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  const context = options.apialize_context || 'default';
  const mergedOptions = mergeModelAndUserOptions(
    model,
    options,
    operationType,
    context
  );

  const config = { ...defaults, ...mergedOptions };

  const isListOrSearch =
    operationType === OPERATION_TYPES.LIST ||
    operationType === OPERATION_TYPES.SEARCH;

  if (isListOrSearch) {
    if (mergedOptions.default_page_size !== undefined) {
      config.defaultPageSize = mergedOptions.default_page_size;
    }
    if (mergedOptions.default_order_by !== undefined) {
      config.defaultOrderBy = mergedOptions.default_order_by;
    }
    if (mergedOptions.default_order_dir !== undefined) {
      config.defaultOrderDir = mergedOptions.default_order_dir;
    }
    if (mergedOptions.meta_show_ordering !== undefined) {
      config.metaShowOrdering = mergedOptions.meta_show_ordering;
    }
    if (mergedOptions.meta_show_filters !== undefined) {
      config.metaShowFilters = mergedOptions.meta_show_filters;
    }
    if (mergedOptions.disable_subquery !== undefined) {
      config.disableSubqueryOnIncludeRequest = mergedOptions.disable_subquery;
    }
  }

  if (operationType === OPERATION_TYPES.LIST) {
    if (mergedOptions.allow_filtering !== undefined) {
      config.allowFiltering = mergedOptions.allow_filtering;
    }
    if (mergedOptions.allow_ordering !== undefined) {
      config.allowOrdering = mergedOptions.allow_ordering;
    }
    if (mergedOptions.allow_filtering_on !== undefined) {
      config.allowFilteringOn = mergedOptions.allow_filtering_on;
    }
    if (mergedOptions.block_filtering_on !== undefined) {
      config.blockFilteringOn = mergedOptions.block_filtering_on;
    }
    if (mergedOptions.allow_ordering_on !== undefined) {
      config.allowOrderingOn = mergedOptions.allow_ordering_on;
    }
    if (mergedOptions.block_ordering_on !== undefined) {
      config.blockOrderingOn = mergedOptions.block_ordering_on;
    }
  }

  if (operationType === OPERATION_TYPES.SEARCH) {
    if (mergedOptions.allow_filtering_on !== undefined) {
      config.allowFilteringOn = mergedOptions.allow_filtering_on;
    }
    if (mergedOptions.block_filtering_on !== undefined) {
      config.blockFilteringOn = mergedOptions.block_filtering_on;
    }
    if (mergedOptions.allow_ordering_on !== undefined) {
      config.allowOrderingOn = mergedOptions.allow_ordering_on;
    }
    if (mergedOptions.block_ordering_on !== undefined) {
      config.blockOrderingOn = mergedOptions.block_ordering_on;
    }
  }

  const isCreateUpdatePatch =
    operationType === OPERATION_TYPES.CREATE ||
    operationType === OPERATION_TYPES.UPDATE ||
    operationType === OPERATION_TYPES.PATCH;

  if (isCreateUpdatePatch) {
    if (mergedOptions.allowed_fields !== undefined) {
      config.allowedFields = mergedOptions.allowed_fields;
    }
    if (mergedOptions.blocked_fields !== undefined) {
      config.blockedFields = mergedOptions.blocked_fields;
    }
  }

  return config;
}

function validateOperationConfig(config, operationType, model) {
  if (config.middleware && !Array.isArray(config.middleware)) {
    throw new Error(`[${operationType}] middleware must be an array`);
  }

  if (config.id_mapping && typeof config.id_mapping !== 'string') {
    throw new Error(`[${operationType}] id_mapping must be a string`);
  }

  if (config.id_mapping && config.id_mapping !== 'id' && model) {
    const hasRawAttributes =
      model.rawAttributes && typeof model.rawAttributes === 'object';
    if (hasRawAttributes && !(config.id_mapping in model.rawAttributes)) {
      const availableFields = Object.keys(model.rawAttributes).join(', ');
      throw new Error(
        `[${operationType}] id_mapping field '${config.id_mapping}' does not exist on model. Available fields: ${availableFields}`
      );
    }
  }

  if (
    config.pre &&
    typeof config.pre !== 'function' &&
    !Array.isArray(config.pre)
  ) {
    throw new Error(
      `[${operationType}] pre hook must be a function or array of functions`
    );
  }

  if (
    config.post &&
    typeof config.post !== 'function' &&
    !Array.isArray(config.post)
  ) {
    throw new Error(
      `[${operationType}] post hook must be a function or array of functions`
    );
  }

  if (operationType === OPERATION_TYPES.CREATE) {
    if (typeof config.validate !== 'boolean') {
      throw new Error(`[${operationType}] validate must be a boolean`);
    }
    if (typeof config.allow_bulk_create !== 'boolean') {
      throw new Error(`[${operationType}] allow_bulk_create must be a boolean`);
    }
  }

  const isListOrSearch =
    operationType === OPERATION_TYPES.LIST ||
    operationType === OPERATION_TYPES.SEARCH;

  if (isListOrSearch) {
    if (
      typeof config.defaultPageSize !== 'number' ||
      config.defaultPageSize <= 0
    ) {
      throw new Error(
        `[${operationType}] defaultPageSize must be a positive number`
      );
    }
  }
}

function createOperationHandler(
  model,
  operationType,
  options = {},
  modelOptions = {}
) {
  validateModelForOperation(model, operationType);

  const config = buildOperationConfig(model, options, operationType);
  validateOperationConfig(config, operationType, model);

  const processor = OPERATION_PROCESSORS[operationType];
  if (!processor) {
    throw new Error(`No processor found for operation type: ${operationType}`);
  }

  // Merge modelOptions from apialize context with provided modelOptions
  const context = options.apialize_context || 'default';
  const effectiveModelOptions = mergeModelAndUserModelOptions(
    model,
    modelOptions,
    operationType,
    context
  );

  const router = express.Router({ mergeParams: true });
  const handlers = buildHandlers(config.middleware, async (req, res) => {
    try {
      const effectiveModel = applyEndpointConfiguration(
        model,
        effectiveModelOptions
      );

      const effectiveOptions = {
        ...options,
        pre: config.pre,
        post: config.post,
      };

      const isReadOnlyOperation =
        operationType === OPERATION_TYPES.SEARCH ||
        operationType === OPERATION_TYPES.LIST ||
        operationType === OPERATION_TYPES.SINGLE;
      const executeWithContext = isReadOnlyOperation
        ? withHooksOnly
        : withTransactionAndHooks;

      let contextExtras = {};
      if (operationType === OPERATION_TYPES.DESTROY) {
        const {
          extractIdFromRequest,
          getOwnershipWhere,
          buildWhereClause,
        } = require('./utils');
        const id = extractIdFromRequest(req);
        const ownershipWhere = getOwnershipWhere(req);
        const where = buildWhereClause(ownershipWhere, config.id_mapping, id);
        contextExtras = { id, where };
      }

      const payload = await executeWithContext(
        {
          model: effectiveModel,
          options: effectiveOptions,
          req,
          res,
          modelOptions: effectiveModelOptions,
          idMapping: config.id_mapping,
          contextExtras,
        },
        async (context) => {
          return await processor(context, config, req, res);
        }
      );

      if (!res.headersSent) {
        if (payload) {
          const isCancelled = payload._apializeCancelled === true;

          let statusCode = 200;
          if (!isCancelled && operationType === OPERATION_TYPES.CREATE) {
            statusCode = 201;
          }

          if (isCancelled) {
            delete payload._apializeCancelled;
            // Use the custom statusCode from cancel_operation if provided
            if (payload._cancelStatusCode !== undefined) {
              statusCode = payload._cancelStatusCode;
              delete payload._cancelStatusCode;
            } else {
              statusCode = 400;
            }
          }

          res.status(statusCode).json(payload);
        }
      }
    } catch (error) {
      console.error(`[Apialize ${operationType}] Error:`, error);

      if (!res.headersSent) {
        const isDevelopment = process.env.NODE_ENV === 'development';
        let statusCode = 500;
        let errorMessage = isDevelopment
          ? error.message
          : 'Internal Server Error';

        if (error.name === 'ValidationError' || error.statusCode === 400) {
          statusCode = 400;
          errorMessage = isDevelopment ? error.message : 'Bad request';
        }

        res.status(statusCode).json({
          success: false,
          error: errorMessage,
          operation: operationType,
        });
      }
    }
  });

  return { router, handlers, config };
}

function create(model, options, modelOptions) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.CREATE,
    options,
    modelOptions
  );

  router.post('/', ...handlers);
  router.apialize = {};
  return router;
}

function update(model, options, modelOptions) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.UPDATE,
    options,
    modelOptions
  );

  router.put('/:id', ...handlers);
  router.apialize = {};
  return router;
}

function patch(model, options, modelOptions) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.PATCH,
    options,
    modelOptions
  );

  router.patch('/:id', ...handlers);
  router.apialize = {};
  return router;
}

function destroy(model, options, modelOptions) {
  const { router, handlers } = createOperationHandler(
    model,
    OPERATION_TYPES.DESTROY,
    options,
    modelOptions
  );

  router.delete('/:id', ...handlers);
  router.apialize = {};
  return router;
}

function list(model, options, modelOptions) {
  const { router, handlers, config } = createOperationHandler(
    model,
    OPERATION_TYPES.LIST,
    options,
    modelOptions
  );

  const disableAutomaticFiltering = function (req, _res, next) {
    req._apializeDisableQueryFilters = true;
    next();
  };

  router.get('/', disableAutomaticFiltering, ...handlers);
  router.apialize = {};
  return router;
}

function single(model, options, modelOptions) {
  const { router, handlers, config } = createOperationHandler(
    model,
    OPERATION_TYPES.SINGLE,
    options,
    modelOptions
  );

  router.get(`/:${config.param_name}`, ...handlers);
  router.apialize = {};
  return router;
}

module.exports = {
  createOperationHandler,
  OPERATION_TYPES,
  create,
  update,
  patch,
  destroy,
  list,
  single,
};

