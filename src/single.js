const utils = require('./utils');
const express = utils.express;
const apializeContext = utils.apializeContext;
const ensureFn = utils.ensureFn;
const asyncHandler = utils.asyncHandler;
const defaultNotFound = utils.defaultNotFound;
const list = require('./list');
const create = require('./create');
const update = require('./update');
const patch = require('./patch');
const destroy = require('./destroy');
const operationUtils = require('./operationUtils');
const withTransactionAndHooks = operationUtils.withTransactionAndHooks;
const optionsWithTransaction = operationUtils.optionsWithTransaction;
const normalizeId = operationUtils.normalizeId;
const notFoundWithRollback = operationUtils.notFoundWithRollback;

function getErrorMessage(err) {
  if (process.env.NODE_ENV === 'development') {
    return String((err && err.message) || err);
  }
  return 'Internal Error';
}

function setupRelatedEndpoints(
  router,
  parentModel,
  related,
  parentIdMapping,
  parentModelOptions,
  parentParamName = 'id'
) {
  related.forEach(function (relatedConfig) {
    if (!relatedConfig.model) {
      throw new Error(
        "Related model configuration must include a 'model' property"
      );
    }

    const relatedModel = relatedConfig.model;
    const relatedOptions = relatedConfig.options || {};
    const perOperation = relatedConfig.perOperation || {};
    const foreignKey = relatedConfig.foreignKey;
    const path = relatedConfig.path;
    const operations = relatedConfig.operations || ['list', 'get'];

    const endpointPath = path || modelNameToPath(relatedModel.name);

    const relatedForeignKey =
      foreignKey || parentModel.name.toLowerCase() + '_id';

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
      var parentParamId = null;
      if (useStoredFirst) {
        if (req.apialize && req.apialize.parentId != null) {
          parentParamId = req.apialize.parentId;
        } else if (req.params && req.params[effectiveParamName] != null) {
          parentParamId = req.params[effectiveParamName];
        } else if (req.params && req.params['id'] != null) {
          parentParamId = req.params['id'];
        }
      } else {
        if (req.params && req.params[effectiveParamName] != null) {
          parentParamId = req.params[effectiveParamName];
        } else if (req.params && req.params['id'] != null) {
          parentParamId = req.params['id'];
        } else if (req.apialize && req.apialize.parentId != null) {
          parentParamId = req.apialize.parentId;
        }
      }
      if (!parentParamId) return null;
      if ((parentIdMapping || 'id') === 'id') return parentParamId;
      const where = {};
      where[parentIdMapping || 'id'] = parentParamId;
      const queryOptions = Object.assign(
        {
          where: where,
          attributes: ['id'],
        },
        parentModelOptions || {}
      );
      try {
        const parent = await parentModel.findOne(queryOptions);
        return parent ? (parent.get ? parent.get('id') : parent.id) : null;
      } catch (_e) {
        return null;
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
        if (!req.apialize) req.apialize = {};
        if (!req.apialize.options) req.apialize.options = {};
        if (!req.apialize.options.where) req.apialize.options.where = {};

        const parentInternalId = await resolveParentInternalId(
          req,
          effectiveParamName,
          preferStoredVal
        );
        if (
          parentInternalId === null ||
          typeof parentInternalId === 'undefined'
        ) {
          req.apialize.options.where[relatedForeignKey] = '__apialize_none__';
        } else {
          req.apialize.options.where[relatedForeignKey] = parentInternalId;
        }
        next();
      });
    };

    const setForeignKeyMiddlewareFactory = function (
      paramName,
      preferStoredArg
    ) {
      const effectiveParamName =
        typeof paramName === 'string' ? paramName : parentParamName;
      const preferStoredVal = Boolean(preferStoredArg);
      return asyncHandler(async function (req, res, next) {
        const writeMethods = ['POST', 'PUT', 'PATCH'];
        if (writeMethods.indexOf(req.method) !== -1) {
          if (!req.apialize) req.apialize = {};
          if (!req.apialize.values) req.apialize.values = {};
          const parentInternalId = await resolveParentInternalId(
            req,
            effectiveParamName,
            preferStoredVal
          );
          if (parentInternalId == null) return defaultNotFound(res);
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

    const baseReadMiddleware = []
      .concat(parentFilterForRead)
      .concat(
        Array.isArray(relatedOptions.middleware)
          ? relatedOptions.middleware
          : []
      );
    const baseWriteMiddleware = []
      .concat(parentFilterForWrite)
      .concat(setForeignKeyMiddlewareFactory(parentParamName, true))
      .concat(
        Array.isArray(relatedOptions.middleware)
          ? relatedOptions.middleware
          : []
      );

    const resolveOpConfig = function (opName) {
      const op =
        perOperation && perOperation[opName] ? perOperation[opName] : {};
      const isWrite =
        opName === 'post' ||
        opName === 'put' ||
        opName === 'patch' ||
        opName === 'delete';
      const baseMw = isWrite ? baseWriteMiddleware : baseReadMiddleware;
      const opMiddleware = Array.isArray(op.middleware) ? op.middleware : [];
      const mergedMiddleware = [].concat(baseMw).concat(opMiddleware);
      const mergedOptions = Object.assign({}, relatedOptions, op);
      mergedOptions.middleware = mergedMiddleware;
      return {
        options: mergedOptions,
        modelOptions: op.modelOptions || relatedOptions.modelOptions || {},
        id_mapping: op.id_mapping || relatedOptions.id_mapping || 'id',
        middleware: mergedMiddleware,
        allow_bulk_delete:
          typeof op.allow_bulk_delete === 'boolean'
            ? op.allow_bulk_delete
            : false,
      };
    };

    const relatedRouter = express.Router({ mergeParams: true });

    const storeParentIdMiddleware = function (req, _res, next) {
      req.apialize = req.apialize || {};
      req.apialize.parentId = req.params[parentParamName];
      next();
    };

    if (operations.indexOf('list') !== -1) {
      const { options: listOptions, modelOptions: listModelOptions } =
        resolveOpConfig('list');
      const relatedListRouter = list(
        relatedModel,
        listOptions,
        listModelOptions
      );
      relatedRouter.use('/', relatedListRouter);
    }

    if (
      operations.indexOf('post') !== -1 ||
      operations.indexOf('create') !== -1
    ) {
      const { options: createOptions, modelOptions: postModelOptions } =
        resolveOpConfig('post');
      const relatedCreateRouter = create(
        relatedModel,
        createOptions,
        postModelOptions
      );
      relatedRouter.use('/', relatedCreateRouter);
    }

    if (operations.indexOf('get') !== -1) {
      const {
        options: getOptions,
        modelOptions: getModelOptions,
        id_mapping: relatedIdMapping,
      } = resolveOpConfig('get');
      const childSingleOptions = Object.assign({}, getOptions);
      // Use a parameter name that matches the actual URL parameter for this model
      const relatedParamName = relatedModel.name.toLowerCase() + 'Id';
      childSingleOptions.param_name = relatedParamName;
      childSingleOptions.id_mapping = relatedIdMapping;
      childSingleOptions.related = Array.isArray(relatedConfig.related)
        ? relatedConfig.related
        : [];
      const childSingleRouter = single(
        relatedModel,
        childSingleOptions,
        getModelOptions
      );
      const nested = express.Router({ mergeParams: true });
      // Create a custom store parent middleware that uses the correct parameter name
      const storeRelatedParentIdMiddleware = function (req, _res, next) {
        req.apialize = req.apialize || {};
        req.apialize.parentId = req.params[relatedParamName];
        next();
      };
      nested.use('/', storeRelatedParentIdMiddleware, childSingleRouter);
      relatedRouter.use('/', nested);
    }

    if (
      operations.indexOf('put') !== -1 ||
      operations.indexOf('update') !== -1
    ) {
      const { options: updateOptions, modelOptions: putModelOptions } =
        resolveOpConfig('put');
      const relatedUpdateRouter = update(
        relatedModel,
        updateOptions,
        putModelOptions || {}
      );
      relatedRouter.use('/', storeParentIdMiddleware, relatedUpdateRouter);
    }

    if (operations.indexOf('patch') !== -1) {
      const { options: patchOptions, modelOptions: patchModelOptions } =
        resolveOpConfig('patch');
      const relatedPatchRouter = patch(
        relatedModel,
        patchOptions,
        patchModelOptions || {}
      );
      relatedRouter.use('/', storeParentIdMiddleware, relatedPatchRouter);
    }

    if (
      operations.indexOf('delete') !== -1 ||
      operations.indexOf('destroy') !== -1
    ) {
      const { options: destroyOptions, modelOptions: deleteModelOptions } =
        resolveOpConfig('delete');
      const relatedDestroyRouter = destroy(
        relatedModel,
        destroyOptions,
        deleteModelOptions || {}
      );
      relatedRouter.use('/', storeParentIdMiddleware, relatedDestroyRouter);

      // Bulk DELETE: when confirm!=true, dry-run and return ids; when confirm==true, delete and return count and ids
      const {
        modelOptions: bulkDelModelOptions,
        id_mapping: bulkDelIdMapping,
        middleware: bulkDelMiddleware,
        allow_bulk_delete,
      } = resolveOpConfig('delete');
      if (allow_bulk_delete) {
        relatedRouter.delete(
          '/',
          storeParentIdMiddleware,
          apializeContext,
          ...bulkDelMiddleware,
          asyncHandler(async (req, res) => {
            const q = req.query || {};
            const confirmVal = String(q.confirm).toLowerCase();
            const confirmed =
              ['true', '1', 'yes', 'y'].indexOf(confirmVal) !== -1;

            const baseWhere =
              (req.apialize &&
                req.apialize.options &&
                req.apialize.options.where) ||
              {};
            if (Object.prototype.hasOwnProperty.call(baseWhere, 'confirm')) {
              delete baseWhere.confirm;
            }

            const findOptions = Object.assign({}, bulkDelModelOptions, {
              where: baseWhere,
              attributes: [bulkDelIdMapping],
            });
            const rows = await relatedModel.findAll(findOptions);
            const ids = [];
            for (var i = 0; i < rows.length; i++) {
              var r = rows[i];
              if (r && typeof r.get === 'function') {
                ids.push(r.get(bulkDelIdMapping));
              } else if (r) {
                ids.push(r[bulkDelIdMapping]);
              }
            }

            if (!confirmed) {
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
      // eslint-disable-next-line no-console
      console.error('[Apialize] Related route error:', err);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    });
    router.use(`/:${parentParamName}/${endpointPath}`, relatedRouter);
  });
}

function modelNameToPath(modelName) {
  const snakeCase = modelName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
  return pluralize(snakeCase);
}

function pluralize(word) {
  if (word.endsWith('y')) {
    return word.slice(0, -1) + 'ies';
  } else if (
    word.endsWith('s') ||
    word.endsWith('sh') ||
    word.endsWith('ch') ||
    word.endsWith('x') ||
    word.endsWith('z')
  ) {
    return word + 'es';
  } else {
    return word + 's';
  }
}

function single(model, options = {}, modelOptions = {}) {
  ensureFn(model, 'findOne');
  const middleware = Array.isArray(options.middleware)
    ? options.middleware
    : [];
  const id_mapping =
    typeof options.id_mapping === 'string' ? options.id_mapping : 'id';
  const param_name =
    typeof options.param_name === 'string' ? options.param_name : 'id';
  const related = Array.isArray(options.related) ? options.related : [];
  const pre = options.pre || null;
  const post = options.post || null;
  const member_routes = Array.isArray(options.member_routes)
    ? options.member_routes
    : [];
  const inline = middleware.filter(function (fn) {
    return typeof fn === 'function';
  });
  const router = express.Router({ mergeParams: true });

  router.get(
    `/:${param_name}`,
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const payload = await withTransactionAndHooks(
        {
          model,
          options: Object.assign({}, options, { pre: pre, post: post }),
          req,
          res,
          modelOptions,
          idMapping: id_mapping,
          useReqOptionsTransaction: true,
        },
        async (context) => {
          // Setup query parameters after pre-hooks (so pre-hooks can modify them)
          const paramValue = req.params[param_name];
          req.apialize.id = paramValue;
          if (!req.apialize.where) req.apialize.where = {};
          if (typeof req.apialize.where[id_mapping] === 'undefined')
            req.apialize.where[id_mapping] = paramValue;
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

          const result = await model.findOne(req.apialize.options);
          if (result == null) {
            return notFoundWithRollback(context);
          }

          context.record = result;
          let recordPayload = result;
          if (recordPayload && typeof recordPayload === 'object')
            recordPayload = recordPayload.get
              ? recordPayload.get({ plain: true })
              : Object.assign({}, recordPayload);

          recordPayload = normalizeId(recordPayload, id_mapping);

          context.payload = { success: true, record: recordPayload };
          return context.payload;
        }
      );
      if (!res.headersSent) {
        res.json(payload);
      }
    })
  );
  const loadSingleRecord = async function (req, res, next) {
    const paramValue = req.params[param_name];
    req.apialize = req.apialize || {};
    req.apialize.id = paramValue;
    req.apialize.where = req.apialize.where || {};
    if (typeof req.apialize.where[id_mapping] === 'undefined') {
      req.apialize.where[id_mapping] = paramValue;
    }
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

    try {
      const result = await model.findOne(req.apialize.options);
      if (result == null) return defaultNotFound(res);

      let recordPayload = result;
      if (recordPayload && typeof recordPayload === 'object') {
        recordPayload = recordPayload.get
          ? recordPayload.get({ plain: true })
          : Object.assign({}, recordPayload);
      }
      recordPayload = normalizeId(recordPayload, id_mapping);
      req.apialize.rawRecord = result;
      req.apialize.record = recordPayload;
      req.apialize.singlePayload = { success: true, record: recordPayload };
      return next();
    } catch (err) {
      return next(err);
    }
  };
  if (Array.isArray(member_routes) && member_routes.length > 0) {
    const allowedList = ['get', 'post', 'put', 'patch', 'delete'];
    function ensureLeadingSlash(p) {
      if (typeof p !== 'string' || p.length === 0) return null;
      if (p.charAt(0) === '/') return p;
      return '/' + p;
    }

    member_routes.forEach(function (route, idx) {
      if (
        !route ||
        typeof route !== 'object' ||
        typeof route.handler !== 'function'
      ) {
        throw new Error(
          `[Apialize] member_routes[${idx}] must be an object with a 'handler' function and a 'path' string`
        );
      }
      const method = String(route.method || 'get').toLowerCase();
      if (allowedList.indexOf(method) === -1) {
        throw new Error(
          `[Apialize] member_routes[${idx}].method must be one of ${allowedList.join(', ')}`
        );
      }
      const subPath = ensureLeadingSlash(route.path || '');
      if (!subPath) {
        throw new Error(
          `[Apialize] member_routes[${idx}] requires a non-empty 'path' (e.g., 'stats' or '/stats')`
        );
      }
      const fullPath = `/:${param_name}${subPath}`;
      const perRouteMw = Array.isArray(route.middleware)
        ? route.middleware
        : [];
      router[method](
        fullPath,
        apializeContext,
        ...inline,
        asyncHandler(loadSingleRecord),
        ...perRouteMw,
        asyncHandler(async (req, res) => {
          const out = await route.handler(req, res);
          if (!res.headersSent) {
            if (typeof out === 'undefined') {
              return res.json(req.apialize.singlePayload);
            }
            return res.json(out);
          }
        })
      );
    });
  }
  if (Array.isArray(related) && related.length > 0) {
    setupRelatedEndpoints(
      router,
      model,
      related,
      id_mapping,
      modelOptions,
      param_name
    );
  }

  router.apialize = {};
  return router;
}

module.exports = single;
