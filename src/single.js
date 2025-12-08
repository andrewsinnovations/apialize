const { single: baseSingle } = require('./operationHandler');
const utils = require('./utils');
const express = utils.express;
const apializeContext = utils.apializeContext;
const asyncHandler = utils.asyncHandler;
const defaultNotFound = utils.defaultNotFound;
const {
  normalizeId,
  applyEndpointConfiguration,
  mergeModelAndUserOptions,
} = require('./operationUtils');

// Import operation handlers for related endpoints
const list = require('./list');
const search = require('./search');
const create = require('./create');
const update = require('./update');
const patch = require('./patch');
const destroy = require('./destroy');

function getErrorMessage(err) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (isDevelopment) {
    const errorMessage = err && err.message;
    const fallbackMessage = errorMessage || err;
    return String(fallbackMessage);
  }
  return 'Internal Error';
}

function validateRelatedConfig(relatedConfig) {
  const hasModel = relatedConfig.model;
  if (!hasModel) {
    throw new Error(
      "Related model configuration must include a 'model' property"
    );
  }
}

function setupRelatedEndpoints(
  router,
  parentModel,
  related,
  parentIdMapping,
  parentModelOptions,
  parentParamName = 'id'
) {
  for (let i = 0; i < related.length; i++) {
    const relatedConfig = related[i];
    validateRelatedConfig(relatedConfig);

    const relatedModel = relatedConfig.model;
    const relatedOptions = relatedConfig.options || {};
    const perOperation = relatedConfig.perOperation || {};
    const foreignKey = relatedConfig.foreignKey;
    const path = relatedConfig.path;
    const operations = relatedConfig.operations || ['list', 'get'];

    const endpointPath = path || modelNameToPath(relatedModel.name);

    // Use configurable param_name, respecting model's underscored setting
    // If underscored=true: {model}_id, otherwise: {model}Id
    const isUnderscored =
      relatedModel.options && relatedModel.options.underscored;
    const modelNameLower = relatedModel.name.toLowerCase();
    const defaultParamName = isUnderscored
      ? modelNameLower + '_id'
      : modelNameLower.charAt(0).toLowerCase() +
        relatedModel.name.slice(1) +
        'Id';
    const relatedParamName = relatedConfig.param_name || defaultParamName;

    const relatedForeignKey =
      foreignKey || parentModel.name.toLowerCase() + '_id';

    const extractParentIdFromStored = function (req) {
      const hasApializeParentId = req.apialize && req.apialize.parentId != null;
      if (hasApializeParentId) {
        return req.apialize.parentId;
      }
      return null;
    };

    const extractParentIdFromParams = function (req, effectiveParamName) {
      const hasParamWithName =
        req.params && req.params[effectiveParamName] != null;
      if (hasParamWithName) {
        return req.params[effectiveParamName];
      }

      const hasIdParam = req.params && req.params['id'] != null;
      if (hasIdParam) {
        return req.params['id'];
      }

      return null;
    };

    const extractParentIdByPreference = function (
      req,
      effectiveParamName,
      useStoredFirst
    ) {
      if (useStoredFirst) {
        const storedId = extractParentIdFromStored(req);
        if (storedId != null) {
          return storedId;
        }
        return extractParentIdFromParams(req, effectiveParamName);
      } else {
        const paramId = extractParentIdFromParams(req, effectiveParamName);
        if (paramId != null) {
          return paramId;
        }
        return extractParentIdFromStored(req);
      }
    };

    const findParentById = async function (parentParamId) {
      const effectiveIdMapping = parentIdMapping || 'id';
      const needsMapping = effectiveIdMapping !== 'id';

      if (!needsMapping) {
        return parentParamId;
      }

      const where = {};
      where[effectiveIdMapping] = parentParamId;
      const queryOptions = Object.assign(
        {
          where: where,
          attributes: ['id'],
        },
        parentModelOptions || {}
      );

      try {
        // Apply endpoint configuration (scopes, schema) before query
        const effectiveParentModel = applyEndpointConfiguration(
          parentModel,
          parentModelOptions
        );

        const parent = await effectiveParentModel.findOne(queryOptions);
        const hasParent = parent;
        if (!hasParent) {
          return null;
        }

        const hasGetMethod = parent.get;
        if (hasGetMethod) {
          return parent.get('id');
        }

        return parent.id;
      } catch (error) {
        return null;
      }
    };

    const resolveParentInternalId = async function (
      req,
      currentParamName,
      preferStored
    ) {
      const effectiveParamName =
        typeof currentParamName === 'string'
          ? currentParamName
          : parentParamName;
      const useStoredFirst = Boolean(preferStored);

      const parentParamId = extractParentIdByPreference(
        req,
        effectiveParamName,
        useStoredFirst
      );

      const hasParentId = parentParamId;
      if (!hasParentId) {
        return null;
      }

      return await findParentById(parentParamId);
    };

    const initializeApializeContext = function (req) {
      if (!req.apialize) {
        req.apialize = {};
      }
      if (!req.apialize.options) {
        req.apialize.options = {};
      }
      if (!req.apialize.options.where) {
        req.apialize.options.where = {};
      }
    };

    const parentFilterMiddlewareFactory = function (
      paramName,
      preferStoredArg
    ) {
      const effectiveParamName =
        typeof paramName === 'string' ? paramName : parentParamName;
      const preferStoredVal = Boolean(preferStoredArg);

      return asyncHandler(async function (req, res, next) {
        initializeApializeContext(req);

        // Clear WHERE clause for this nested level to avoid accumulating
        // constraints from parent levels that don't apply to this model
        req.apialize.options.where = {};

        const parentInternalId = await resolveParentInternalId(
          req,
          effectiveParamName,
          preferStoredVal
        );

        const hasParentId =
          parentInternalId !== null && typeof parentInternalId !== 'undefined';

        if (hasParentId) {
          // Check if this is a many-to-many relationship with a through table
          const hasThroughModel = relatedConfig.through;

          if (hasThroughModel) {
            // Many-to-many: use include with through table
            if (!req.apialize.options.include) {
              req.apialize.options.include = [];
            }

            // Build the include object for the through table
            const throughInclude = {
              model: relatedConfig.through,
              where: { [relatedForeignKey]: parentInternalId },
              required: true,
              attributes: [], // Don't include through table attributes in results
            };

            // Add the 'as' alias if provided in the related config
            if (relatedConfig.as) {
              throughInclude.as = relatedConfig.as;
            }

            req.apialize.options.include.push(throughInclude);
          } else {
            // Direct foreign key relationship
            req.apialize.options.where[relatedForeignKey] = parentInternalId;
          }
        } else {
          // No parent ID found - filter to return no results
          if (relatedConfig.through) {
            // For many-to-many, use an impossible condition
            if (!req.apialize.options.include) {
              req.apialize.options.include = [];
            }

            const throughInclude = {
              model: relatedConfig.through,
              where: { [relatedForeignKey]: '__apialize_none__' },
              required: true,
              attributes: [],
            };

            if (relatedConfig.as) {
              throughInclude.as = relatedConfig.as;
            }

            req.apialize.options.include.push(throughInclude);
          } else {
            req.apialize.options.where[relatedForeignKey] = '__apialize_none__';
          }
        }

        next();
      });
    };

    const isWriteMethod = function (method) {
      const writeMethods = ['POST', 'PUT', 'PATCH'];
      return writeMethods.indexOf(method) !== -1;
    };

    const initializeApializeValues = function (req) {
      if (!req.apialize) {
        req.apialize = {};
      }
      if (!req.apialize.values) {
        req.apialize.values = {};
      }
    };

    const setForeignKeyMiddlewareFactory = function (
      paramName,
      preferStoredArg
    ) {
      const effectiveParamName =
        typeof paramName === 'string' ? paramName : parentParamName;
      const preferStoredVal = Boolean(preferStoredArg);

      return asyncHandler(async function (req, res, next) {
        const isWrite = isWriteMethod(req.method);
        if (isWrite) {
          initializeApializeValues(req);

          const parentInternalId = await resolveParentInternalId(
            req,
            effectiveParamName,
            preferStoredVal
          );

          const hasParentId = parentInternalId != null;
          if (!hasParentId) {
            return defaultNotFound(res);
          }

          req.apialize.values[relatedForeignKey] = parentInternalId;
        }
        next();
      });
    };

    const parentFilterForRead = parentFilterMiddlewareFactory(
      parentParamName,
      false
    );
    const parentFilterForWrite = parentFilterMiddlewareFactory(
      parentParamName,
      true
    );

    const getRelatedMiddleware = function (relatedOptions) {
      const isArrayMiddleware = Array.isArray(relatedOptions.middleware);
      if (isArrayMiddleware) {
        return relatedOptions.middleware;
      }
      return [];
    };

    const buildBaseMiddleware = function (
      parentFilters,
      additionalMiddleware,
      relatedOptions
    ) {
      const relatedMiddleware = getRelatedMiddleware(relatedOptions);
      const middleware = [];

      for (let i = 0; i < parentFilters.length; i++) {
        middleware.push(parentFilters[i]);
      }

      for (let i = 0; i < additionalMiddleware.length; i++) {
        middleware.push(additionalMiddleware[i]);
      }

      for (let i = 0; i < relatedMiddleware.length; i++) {
        middleware.push(relatedMiddleware[i]);
      }

      return middleware;
    };

    const baseReadMiddleware = buildBaseMiddleware(
      [parentFilterForRead],
      [],
      relatedOptions
    );
    const baseWriteMiddleware = buildBaseMiddleware(
      [parentFilterForWrite],
      [setForeignKeyMiddlewareFactory(parentParamName, true)],
      relatedOptions
    );

    const getOperationConfig = function (perOperation, opName) {
      const hasOperationConfig = perOperation && perOperation[opName];
      if (hasOperationConfig) {
        return perOperation[opName];
      }
      return {};
    };

    const isWriteOperation = function (opName) {
      const writeOperations = ['post', 'put', 'patch', 'delete'];
      return writeOperations.indexOf(opName) !== -1;
    };

    const getOperationMiddleware = function (op) {
      const isArrayMiddleware = Array.isArray(op.middleware);
      if (isArrayMiddleware) {
        return op.middleware;
      }
      return [];
    };

    const mergeMiddleware = function (baseMiddleware, operationMiddleware) {
      const merged = [];

      for (let i = 0; i < baseMiddleware.length; i++) {
        merged.push(baseMiddleware[i]);
      }

      for (let i = 0; i < operationMiddleware.length; i++) {
        merged.push(operationMiddleware[i]);
      }

      return merged;
    };

    const resolveOpConfig = function (opName) {
      const op = getOperationConfig(perOperation, opName);
      const isWrite = isWriteOperation(opName);

      // Get operation-specific middleware only (not including parent filters)
      // Parent filters will be applied at the router level instead
      const opMiddleware = getOperationMiddleware(op);
      const relatedMiddleware = getRelatedMiddleware(relatedOptions);
      const mergedMiddleware = mergeMiddleware(relatedMiddleware, opMiddleware);

      const mergedOptions = Object.assign({}, relatedOptions, op);
      mergedOptions.middleware = mergedMiddleware;

      const allowBulkDelete =
        typeof op.allow_bulk_delete === 'boolean'
          ? op.allow_bulk_delete
          : false;

      return {
        options: mergedOptions,
        modelOptions: op.modelOptions || relatedOptions.modelOptions || {},
        id_mapping: op.id_mapping || relatedOptions.id_mapping || 'id',
        middleware: mergedMiddleware,
        allow_bulk_delete: allowBulkDelete,
        // Return parent filters separately so they can be applied at router level
        parentFilterForRead: isWrite ? null : parentFilterForRead,
        parentFilterForWrite: isWrite ? parentFilterForWrite : null,
        setForeignKeyMiddleware: isWrite
          ? setForeignKeyMiddlewareFactory(parentParamName, true)
          : null,
      };
    };

    const relatedRouter = express.Router({ mergeParams: true });

    const storeParentIdMiddleware = function (req, _res, next) {
      req.apialize = req.apialize || {};
      req.apialize.parentId = req.params[parentParamName];
      next();
    };

    const hasOperation = function (operations, operationName) {
      return operations.indexOf(operationName) !== -1;
    };

    const hasListOperation = hasOperation(operations, 'list');
    if (hasListOperation) {
      const {
        options: listOptions,
        modelOptions: listModelOptions,
        parentFilterForRead,
      } = resolveOpConfig('list');
      const relatedListRouter = list(
        relatedModel,
        listOptions,
        listModelOptions
      );
      // Apply parent filter before the list operation
      if (parentFilterForRead) {
        relatedRouter.use('/', parentFilterForRead, relatedListRouter);
      } else {
        relatedRouter.use('/', relatedListRouter);
      }
    }

    const hasSearchOperation = hasOperation(operations, 'search');
    if (hasSearchOperation) {
      const {
        options: searchOptions,
        modelOptions: searchModelOptions,
        parentFilterForRead,
      } = resolveOpConfig('search');
      const relatedSearchRouter = search(
        relatedModel,
        searchOptions,
        searchModelOptions
      );
      // Apply parent filter before the search operation
      if (parentFilterForRead) {
        relatedRouter.use('/', parentFilterForRead, relatedSearchRouter);
      } else {
        relatedRouter.use('/', relatedSearchRouter);
      }
    }

    const hasPostOperation = hasOperation(operations, 'post');
    const hasCreateOperation = hasOperation(operations, 'create');
    const hasCreateOrPost = hasPostOperation || hasCreateOperation;

    if (hasCreateOrPost) {
      const {
        options: createOptions,
        modelOptions: postModelOptions,
        parentFilterForWrite,
        setForeignKeyMiddleware,
      } = resolveOpConfig('post');
      const relatedCreateRouter = create(
        relatedModel,
        createOptions,
        postModelOptions
      );
      // Apply parent filter and foreign key setter before create operation
      const writeMiddleware = [];
      if (parentFilterForWrite) writeMiddleware.push(parentFilterForWrite);
      if (setForeignKeyMiddleware)
        writeMiddleware.push(setForeignKeyMiddleware);

      if (writeMiddleware.length > 0) {
        relatedRouter.use('/', ...writeMiddleware, relatedCreateRouter);
      } else {
        relatedRouter.use('/', relatedCreateRouter);
      }
    }

    const hasGetOperation = hasOperation(operations, 'get');
    if (hasGetOperation) {
      const {
        options: getOptions,
        modelOptions: getModelOptions,
        id_mapping: relatedIdMapping,
        parentFilterForRead,
      } = resolveOpConfig('get');

      const childSingleOptions = Object.assign({}, getOptions);
      childSingleOptions.param_name = relatedParamName;
      childSingleOptions.id_mapping = relatedIdMapping;

      const hasRelatedConfig = Array.isArray(relatedConfig.related);
      childSingleOptions.related = hasRelatedConfig
        ? relatedConfig.related
        : [];

      const childSingleRouter = single(
        relatedModel,
        childSingleOptions,
        getModelOptions
      );

      const nested = express.Router({ mergeParams: true });
      const storeRelatedParentIdMiddleware = function (req, _res, next) {
        req.apialize = req.apialize || {};
        req.apialize.parentId = req.params[relatedParamName];
        next();
      };

      // Apply parent filter at router level (before child operation's pre/post hooks)
      const nestedMiddleware = [];
      if (parentFilterForRead) nestedMiddleware.push(parentFilterForRead);
      nestedMiddleware.push(storeRelatedParentIdMiddleware);
      nestedMiddleware.push(childSingleRouter);

      nested.use('/', ...nestedMiddleware);
      relatedRouter.use('/', nested);
    }

    const hasPutOperation = hasOperation(operations, 'put');
    const hasUpdateOperation = hasOperation(operations, 'update');
    const hasUpdateOrPut = hasPutOperation || hasUpdateOperation;

    if (hasUpdateOrPut) {
      const {
        options: updateOptions,
        modelOptions: putModelOptions,
        parentFilterForWrite,
        setForeignKeyMiddleware,
      } = resolveOpConfig('put');
      const relatedUpdateRouter = update(
        relatedModel,
        updateOptions,
        putModelOptions || {}
      );
      // Apply parent filter at router level (before child operation's pre/post hooks)
      const writeMiddleware = [storeParentIdMiddleware];
      if (parentFilterForWrite) writeMiddleware.push(parentFilterForWrite);
      if (setForeignKeyMiddleware)
        writeMiddleware.push(setForeignKeyMiddleware);

      relatedRouter.use('/', ...writeMiddleware, relatedUpdateRouter);
    }

    const hasPatchOperation = hasOperation(operations, 'patch');
    if (hasPatchOperation) {
      const {
        options: patchOptions,
        modelOptions: patchModelOptions,
        parentFilterForWrite,
        setForeignKeyMiddleware,
      } = resolveOpConfig('patch');
      const relatedPatchRouter = patch(
        relatedModel,
        patchOptions,
        patchModelOptions || {}
      );
      // Apply parent filter at router level (before child operation's pre/post hooks)
      const writeMiddleware = [storeParentIdMiddleware];
      if (parentFilterForWrite) writeMiddleware.push(parentFilterForWrite);
      if (setForeignKeyMiddleware)
        writeMiddleware.push(setForeignKeyMiddleware);

      relatedRouter.use('/', ...writeMiddleware, relatedPatchRouter);
    }

    const hasDeleteOperation = hasOperation(operations, 'delete');
    const hasDestroyOperation = hasOperation(operations, 'destroy');
    const hasDeleteOrDestroy = hasDeleteOperation || hasDestroyOperation;

    if (hasDeleteOrDestroy) {
      const {
        options: destroyOptions,
        modelOptions: deleteModelOptions,
        parentFilterForWrite,
        setForeignKeyMiddleware,
      } = resolveOpConfig('delete');
      const relatedDestroyRouter = destroy(
        relatedModel,
        destroyOptions,
        deleteModelOptions || {}
      );
      // Apply parent filter at router level (before child operation's pre/post hooks)
      const writeMiddleware = [storeParentIdMiddleware];
      if (parentFilterForWrite) writeMiddleware.push(parentFilterForWrite);
      if (setForeignKeyMiddleware)
        writeMiddleware.push(setForeignKeyMiddleware);

      relatedRouter.use('/', ...writeMiddleware, relatedDestroyRouter);

      const {
        modelOptions: bulkDelModelOptions,
        id_mapping: bulkDelIdMapping,
        middleware: bulkDelMiddleware,
        allow_bulk_delete,
        parentFilterForWrite: bulkDelParentFilter,
      } = resolveOpConfig('delete');

      const shouldAllowBulkDelete = allow_bulk_delete;
      if (shouldAllowBulkDelete) {
        const isConfirmed = function (queryParams) {
          const query = queryParams || {};
          const confirmVal = String(query.confirm).toLowerCase();
          const confirmValues = ['true', '1', 'yes', 'y'];
          return confirmValues.indexOf(confirmVal) !== -1;
        };

        const getBaseWhere = function (req) {
          const hasApializeOptions =
            req.apialize && req.apialize.options && req.apialize.options.where;
          const baseWhere = hasApializeOptions
            ? req.apialize.options.where
            : {};

          const hasConfirmProperty = Object.prototype.hasOwnProperty.call(
            baseWhere,
            'confirm'
          );
          if (hasConfirmProperty) {
            delete baseWhere.confirm;
          }

          return baseWhere;
        };

        const extractIdsFromRows = function (rows, idMapping) {
          const ids = [];

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const hasRow = row;
            if (!hasRow) {
              continue;
            }

            const hasGetMethod = typeof row.get === 'function';
            if (hasGetMethod) {
              ids.push(row.get(idMapping));
            } else {
              ids.push(row[idMapping]);
            }
          }

          return ids;
        };

        // Build middleware for bulk delete route
        const bulkDelRouteMiddleware = [storeParentIdMiddleware];
        if (bulkDelParentFilter) {
          bulkDelRouteMiddleware.push(bulkDelParentFilter);
        }
        bulkDelRouteMiddleware.push(apializeContext);
        bulkDelRouteMiddleware.push(...bulkDelMiddleware);

        relatedRouter.delete(
          '/',
          ...bulkDelRouteMiddleware,
          asyncHandler(async (req, res) => {
            const confirmed = isConfirmed(req.query);
            const baseWhere = getBaseWhere(req);

            const findOptions = Object.assign({}, bulkDelModelOptions, {
              where: baseWhere,
              attributes: [bulkDelIdMapping],
            });

            const rows = await relatedModel.findAll(findOptions);
            const ids = extractIdsFromRows(rows, bulkDelIdMapping);

            const needsConfirmation = !confirmed;
            if (needsConfirmation) {
              return res.json({ success: true, confirm_required: true, ids });
            }

            try {
              const destroyOptions = Object.assign({}, bulkDelModelOptions, {
                where: baseWhere,
              });
              const deleted = await relatedModel.destroy(destroyOptions);
              return res.json({ success: true, deleted, ids });
            } catch (err) {
              console.error('[Apialize] Bulk delete error:', err);
              return res.status(500).json({
                success: false,
                error: getErrorMessage(err),
              });
            }
          })
        );
      }
    }
    relatedRouter.use(function (err, _req, res, _next) {
      console.error('[Apialize] Related route error:', err);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    });
    router.use(`/:${parentParamName}/${endpointPath}`, relatedRouter);
  }
}

function modelNameToPath(modelName) {
  const snakeCase = modelName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
  return pluralize(snakeCase);
}

function endsWithY(word) {
  return word.endsWith('y');
}

function endsWithSpecialChars(word) {
  const specialEndings = ['s', 'sh', 'ch', 'x', 'z'];

  for (let i = 0; i < specialEndings.length; i++) {
    const ending = specialEndings[i];
    const hasEnding = word.endsWith(ending);
    if (hasEnding) {
      return true;
    }
  }

  return false;
}

function pluralize(word) {
  const hasYEnding = endsWithY(word);
  if (hasYEnding) {
    return word.slice(0, -1) + 'ies';
  }

  const hasSpecialEnding = endsWithSpecialChars(word);
  if (hasSpecialEnding) {
    return word + 'es';
  }

  return word + 's';
}

function extractMiddlewareFunctions(middleware) {
  const isArrayMiddleware = Array.isArray(middleware);
  if (!isArrayMiddleware) {
    return [];
  }

  const functions = [];
  for (let i = 0; i < middleware.length; i++) {
    const item = middleware[i];
    const isFunction = typeof item === 'function';
    if (isFunction) {
      functions.push(item);
    }
  }

  return functions;
}

function extractStringOption(options, key, defaultValue) {
  const value = options[key];
  const isString = typeof value === 'string';
  if (isString) {
    return value;
  }
  return defaultValue;
}

function extractArrayOption(options, key) {
  const value = options[key];
  const isArray = Array.isArray(value);
  if (isArray) {
    return value;
  }
  return [];
}

function setupMemberRoutes(
  router,
  model,
  memberRoutes,
  paramName,
  idMapping,
  modelOptions,
  options
) {
  const middleware = extractArrayOption(options, 'middleware');
  const inline = extractMiddlewareFunctions(middleware);

  const convertToPlainObject = function (recordPayload) {
    const isObject = recordPayload && typeof recordPayload === 'object';
    if (!isObject) {
      return recordPayload;
    }

    const hasGetMethod = recordPayload.get;
    if (hasGetMethod) {
      return recordPayload.get({ plain: true });
    }

    return Object.assign({}, recordPayload);
  };

  const setupApializeContext = function (req, paramValue, idMapping) {
    req.apialize.id = paramValue;

    if (!req.apialize.where) {
      req.apialize.where = {};
    }

    const whereNotSet = typeof req.apialize.where[idMapping] === 'undefined';
    if (whereNotSet) {
      req.apialize.where[idMapping] = paramValue;
    }
  };

  const buildQueryOptions = function (req, modelOptions) {
    req.apialize.options = Object.assign(
      {},
      modelOptions,
      req.apialize.options || {}
    );

    const modelWhere = (modelOptions && modelOptions.where) || {};
    const reqOptionsWhere =
      (req.apialize.options && req.apialize.options.where) || {};
    const fullWhere = Object.assign(
      {},
      modelWhere,
      reqOptionsWhere,
      req.apialize.where
    );

    req.apialize.options.where = fullWhere;
  };

  const initializeApializeForLoad = function (req) {
    req.apialize = req.apialize || {};
    req.apialize.where = req.apialize.where || {};
  };

  const loadSingleRecord = async function (req, res, next) {
    const paramValue = req.params[paramName];
    initializeApializeForLoad(req);

    setupApializeContext(req, paramValue, idMapping);
    buildQueryOptions(req, modelOptions);

    try {
      // Apply endpoint configuration (scopes, schema) before query
      const effectiveModel = applyEndpointConfiguration(model, modelOptions);

      const result = await effectiveModel.findOne(req.apialize.options);
      const hasResult = result != null;
      if (!hasResult) {
        return defaultNotFound(res);
      }

      let recordPayload = convertToPlainObject(result);
      recordPayload = normalizeId(recordPayload, idMapping);

      req.apialize.rawRecord = result;
      req.apialize.record = recordPayload;
      req.apialize.singlePayload = { success: true, record: recordPayload };

      // Add models shortcut to context for member_routes
      if (model && model.sequelize && model.sequelize.models) {
        req.apialize.models = model.sequelize.models;
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };

  const validateRoute = function (route, index) {
    const isValidRoute =
      route && typeof route === 'object' && typeof route.handler === 'function';
    if (!isValidRoute) {
      throw new Error(
        `[Apialize] member_routes[${index}] must be an object with a 'handler' function and a 'path' string`
      );
    }
  };

  const validateRouteMethod = function (route, index, allowedMethods) {
    const method = String(route.method || 'get').toLowerCase();
    const isAllowedMethod = allowedMethods.indexOf(method) !== -1;
    if (!isAllowedMethod) {
      throw new Error(
        `[Apialize] member_routes[${index}].method must be one of ${allowedMethods.join(', ')}`
      );
    }
    return method;
  };

  const ensureLeadingSlash = function (path) {
    const isValidString = typeof path === 'string' && path.length > 0;
    if (!isValidString) {
      return null;
    }

    const hasLeadingSlash = path.charAt(0) === '/';
    if (hasLeadingSlash) {
      return path;
    }

    return '/' + path;
  };

  const validateRoutePath = function (route, index) {
    const subPath = ensureLeadingSlash(route.path || '');
    const hasValidPath = subPath;
    if (!hasValidPath) {
      throw new Error(
        `[Apialize] member_routes[${index}] requires a non-empty 'path' (e.g., 'stats' or '/stats')`
      );
    }
    return subPath;
  };

  const getRouteMiddleware = function (route) {
    const isArrayMiddleware = Array.isArray(route.middleware);
    if (isArrayMiddleware) {
      return route.middleware;
    }
    return [];
  };

  const allowedMethods = ['get', 'post', 'put', 'patch', 'delete'];

  for (let i = 0; i < memberRoutes.length; i++) {
    const route = memberRoutes[i];

    validateRoute(route, i);
    const method = validateRouteMethod(route, i, allowedMethods);
    const subPath = validateRoutePath(route, i);

    const fullPath = `/:${paramName}${subPath}`;
    const perRouteMiddleware = getRouteMiddleware(route);

    router[method](
      fullPath,
      apializeContext,
      ...inline,
      asyncHandler(loadSingleRecord),
      ...perRouteMiddleware,
      asyncHandler(async (req, res) => {
        // Pass context as third parameter (optional, doesn't interfere with Express)
        const context = req.apialize || {};
        const handlerOutput = await route.handler(req, res, context);
        const responseNotSent = !res.headersSent;
        if (responseNotSent) {
          const hasOutput = typeof handlerOutput !== 'undefined';
          if (hasOutput) {
            return res.json(handlerOutput);
          }
          return res.json(req.apialize.singlePayload);
        }
      })
    );
  }
}

function single(model, options = {}, modelOptions = {}) {
  // Merge model-based apialize configuration with user options for the single wrapper
  // Use apialize_context if specified, otherwise use 'default'
  const context = options.apialize_context || 'default';
  const mergedOptions = mergeModelAndUserOptions(
    model,
    options,
    'single',
    context
  );

  const router = baseSingle(model, mergedOptions, modelOptions);

  const idMapping = extractStringOption(mergedOptions, 'id_mapping', 'id');
  const paramName = extractStringOption(mergedOptions, 'param_name', 'id');
  const related = extractArrayOption(mergedOptions, 'related');
  const memberRoutes = extractArrayOption(mergedOptions, 'member_routes');

  // Add member routes (custom routes on the single resource)
  const hasMemberRoutes =
    Array.isArray(memberRoutes) && memberRoutes.length > 0;
  if (hasMemberRoutes) {
    setupMemberRoutes(
      router,
      model,
      memberRoutes,
      paramName,
      idMapping,
      modelOptions,
      mergedOptions
    );
  }

  // Add related endpoints
  const hasRelatedEndpoints = Array.isArray(related) && related.length > 0;
  if (hasRelatedEndpoints) {
    setupRelatedEndpoints(
      router,
      model,
      related,
      idMapping,
      modelOptions,
      paramName
    );
  }

  return router;
}

module.exports = single;
