const { express, apializeContext, ensureFn, asyncHandler } = require('./utils');
const {
  withTransactionAndHooks,
  normalizeRows,
  normalizeRowsWithForeignKeys,
} = require('./operationUtils');
const {
  getModelAttributes,
  validateColumnExists,
  resolveIncludedAttribute,
  validateDataType,
  setupPagination,
  setupOrdering,
  setupFiltering,
  buildResponse,
} = require('./listUtils');

// Default configuration for list operation
const LIST_DEFAULTS = {
  middleware: [],
  allowFiltering: true, // allow non "api:" query params to become where filters
  allowOrdering: true, // allow api:orderby / api:orderdir query params
  metaShowFilters: false, // include applied filters in meta.filters
  metaShowOrdering: false, // include applied ordering in meta.order
  defaultPageSize: 100, // default page size when not specified in query or model config
  defaultOrderBy: 'id', // default column to order by when no ordering is specified
  defaultOrderDir: 'ASC', // default order direction when no ordering is specified
  pre: null,
  post: null,
  // relation_id_mapping allows mapping relation 'id' filters to custom fields
  relation_id_mapping: null,
};

function list(model, options = {}, modelOptions = {}) {
  ensureFn(model, 'findAndCountAll');
  const mergedOptions = Object.assign({}, LIST_DEFAULTS, options);
  const middleware = mergedOptions.middleware;
  const allowFiltering = mergedOptions.allowFiltering;
  const allowOrdering = mergedOptions.allowOrdering;
  const metaShowFilters = mergedOptions.metaShowFilters;
  const metaShowOrdering = mergedOptions.metaShowOrdering;
  const defaultPageSize = mergedOptions.defaultPageSize;
  const defaultOrderBy = mergedOptions.defaultOrderBy;
  const defaultOrderDir = mergedOptions.defaultOrderDir;
  const id_mapping = mergedOptions.id_mapping;
  const relationIdMapping = mergedOptions.relation_id_mapping;
  const pre = mergedOptions.pre;
  const post = mergedOptions.post;

  const idMapping = id_mapping || 'id';

  const inline = [];
  for (let i = 0; i < middleware.length; i++) {
    const fn = middleware[i];
    if (typeof fn === 'function') inline.push(fn);
  }
  const router = express.Router({ mergeParams: true });

  router.get(
    '/',
    (req, _res, next) => {
      if (!allowFiltering) req._apializeDisableQueryFilters = true;
      next();
    },
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const q = req.query || {};
      const modelCfg = (model && model.apialize) || {};

      const mergedReqOptions = Object.assign({}, modelOptions);
      if (req.apialize.options && typeof req.apialize.options === 'object') {
        const keys = Object.keys(req.apialize.options);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          mergedReqOptions[k] = req.apialize.options[k];
        }
      }
      req.apialize.options = mergedReqOptions;

      const payload = await withTransactionAndHooks(
        {
          model,
          options: { ...options, pre, post },
          req,
          res,
          modelOptions,
          idMapping,
          useReqOptionsTransaction: true,
        },
        async (context) => {
          // Setup pagination, ordering, and filtering after pre-hooks (so pre-hooks can modify them)
          const { page, pageSize } = setupPagination(
            req,
            q,
            modelCfg,
            defaultPageSize
          );

          const orderingValid = setupOrdering(
            req,
            res,
            model,
            q,
            modelCfg,
            allowOrdering,
            defaultOrderBy,
            defaultOrderDir,
            idMapping,
            relationIdMapping
          );
          if (!orderingValid) return; // Response already sent

          const appliedFilters = setupFiltering(
            req,
            res,
            model,
            q,
            allowFiltering,
            relationIdMapping
          );
          if (appliedFilters === false) return; // Response already sent

          const result = await model.findAndCountAll(req.apialize.options);

          // Create a normalizer function that includes foreign key mapping
          const normalizeRowsFn = async (rows, idMappingParam) => {
            return await normalizeRowsWithForeignKeys(
              rows,
              idMappingParam,
              relationIdMapping,
              model
            );
          };

          const response = await buildResponse(
            result,
            page,
            pageSize,
            appliedFilters,
            metaShowFilters,
            metaShowOrdering,
            allowFiltering,
            req,
            idMapping,
            normalizeRowsFn
          );
          context.payload = response;
          return context.payload;
        }
      );
      if (!res.headersSent) {
        res.json(payload);
      }
    })
  );

  router.apialize = {};
  return router;
}

module.exports = list;
