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
} = require('./operationUtils');

// Import individual operation processors
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
    id_mapping: 'id',
    middleware: [],
    pre: null,
    post: null,
  },
  [OPERATION_TYPES.UPDATE]: {
    validate: true,
    id_mapping: 'id',
    middleware: [],
    pre: null,
    post: null,
  },
  [OPERATION_TYPES.PATCH]: {
    validate: true,
    id_mapping: 'id',
    middleware: [],
    pre: null,
    post: null,
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
  },
  [OPERATION_TYPES.SEARCH]: {
    middleware: [],
    path: '/',
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

function buildOperationConfig(options = {}, operationType) {
  const defaults = OPERATION_DEFAULTS[operationType];
  if (!defaults) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  const config = {};

  // Apply defaults first
  const defaultKeys = Object.keys(defaults);
  for (let i = 0; i < defaultKeys.length; i++) {
    const key = defaultKeys[i];
    config[key] = defaults[key];
  }

  // Override with user options
  const optionKeys = Object.keys(options);
  for (let i = 0; i < optionKeys.length; i++) {
    const key = optionKeys[i];
    config[key] = options[key];
  }

  return config;
}

function validateOperationConfig(config, operationType) {
  // Validate middleware
  if (config.middleware && !Array.isArray(config.middleware)) {
    throw new Error(`[${operationType}] middleware must be an array`);
  }

  // Validate id_mapping
  if (config.id_mapping && typeof config.id_mapping !== 'string') {
    throw new Error(`[${operationType}] id_mapping must be a string`);
  }

  // Validate hooks
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

  if (operationType === OPERATION_TYPES.LIST) {
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
  // Step 1: Validate model has required methods
  validateModelForOperation(model, operationType);

  // Step 2: Build and validate configuration
  const config = buildOperationConfig(options, operationType);
  validateOperationConfig(config, operationType);

  // Step 3: Get operation processor
  const processor = OPERATION_PROCESSORS[operationType];
  if (!processor) {
    throw new Error(`No processor found for operation type: ${operationType}`);
  }

  // Step 4: Setup middleware and handlers
  const router = express.Router({ mergeParams: true });

  // Step 5: Create the unified handler
  const handlers = buildHandlers(config.middleware, async (req, res) => {
    try {
      // Apply endpoint configuration (scopes, schema)
      const effectiveModel = applyEndpointConfiguration(model, modelOptions);

      // Create effective options with hooks
      const effectiveOptions = {
        ...options,
        pre: config.pre,
        post: config.post,
      };

      // Execute with or without transactions based on operation type
      const isReadOnlyOperation =
        operationType === OPERATION_TYPES.SEARCH ||
        operationType === OPERATION_TYPES.LIST ||
        operationType === OPERATION_TYPES.SINGLE;
      const executeWithContext = isReadOnlyOperation
        ? withHooksOnly
        : withTransactionAndHooks;

      const payload = await executeWithContext(
        {
          model: effectiveModel,
          options: effectiveOptions,
          req,
          res,
          modelOptions,
          idMapping: config.id_mapping,
        },
        async (context) => {
          // Delegate to operation-specific processor
          return await processor(context, config, req, res);
        }
      );

      // Send response if not already sent
      if (!res.headersSent && payload) {
        // Determine status code based on operation
        let statusCode = 200;
        if (operationType === OPERATION_TYPES.CREATE) {
          statusCode = 201;
        }

        res.status(statusCode).json(payload);
      }
    } catch (error) {
      // Enhanced error handling with operation context
      console.error(`[Apialize ${operationType}] Error:`, error);

      if (!res.headersSent) {
        const isDevelopment = process.env.NODE_ENV === 'development';
        let statusCode = 500;
        let errorMessage = isDevelopment
          ? error.message
          : 'Internal Server Error';

        // Handle validation errors
        if (error.name === 'ValidationError' || error.statusCode === 400) {
          statusCode = 400;
          errorMessage = 'Bad request';
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

  const filteringMiddleware = function (req, _res, next) {
    if (!config.allowFiltering) {
      req._apializeDisableQueryFilters = true;
    }
    next();
  };

  router.get('/', filteringMiddleware, ...handlers);
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
