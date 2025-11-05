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
const { executeSearchOperation } = require('./search');

// Default configuration for list operation
const LIST_DEFAULTS = {
  middleware: [],
  allowFiltering: true, // allow non "api:" query params to become where filters
  allowOrdering: true, // allow api:order_by / api:order_dir query params
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

// Convert list query parameters to search operation format
function convertListQueryToSearchBody(query, modelCfg, listOptions) {
  const searchBody = {
    filtering: {},
    ordering: null,
    paging: {},
  };

  // Convert pagination parameters
  let page = parseInt(query['api:page'], 10);
  if (isNaN(page) || page < 1) page = 1;
  searchBody.paging.page = page;

  const effectivePageSize =
    Number.isInteger(modelCfg.page_size) && modelCfg.page_size > 0
      ? modelCfg.page_size
      : listOptions.defaultPageSize;

  let pageSize = parseInt(query['api:page_size'], 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = effectivePageSize;
  searchBody.paging.size = pageSize;

  // Convert ordering parameters
  let rawOrderBy, globalDir;

  if (listOptions.allowOrdering) {
    rawOrderBy = query['api:order_by'] || modelCfg.orderby;
    globalDir = (
      query['api:order_dir'] ||
      modelCfg.orderdir ||
      listOptions.defaultOrderDir
    )
      .toString()
      .toUpperCase();
  } else {
    // When ordering is disabled, only use model config (ignore query parameters)
    rawOrderBy = modelCfg.orderby;
    globalDir = (modelCfg.orderdir || listOptions.defaultOrderDir)
      .toString()
      .toUpperCase();
  }

  if (rawOrderBy) {
    const splitFields = rawOrderBy.split(',');
    const orderingArray = [];

    for (const field of splitFields) {
      const trimmed = field?.toString().trim();
      if (!trimmed) continue;

      let columnName, direction;
      if (trimmed.charAt(0) === '-') {
        columnName = trimmed.slice(1);
        direction = 'DESC';
      } else if (trimmed.charAt(0) === '+') {
        columnName = trimmed.slice(1);
        direction = 'ASC';
      } else {
        columnName = trimmed;
        direction = globalDir === 'DESC' ? 'DESC' : 'ASC';
      }

      orderingArray.push({
        order_by: columnName,
        direction: direction,
      });
    }

    if (orderingArray.length > 0) {
      searchBody.ordering = orderingArray;
    }
  }

  // If no ordering was set, use defaults
  if (!searchBody.ordering) {
    searchBody.ordering = [
      {
        order_by: listOptions.defaultOrderBy,
        direction: listOptions.defaultOrderDir,
      },
    ];
  }

  // Convert filtering parameters
  if (listOptions.allowFiltering) {
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('api:')) continue;
      if (value === undefined) continue;

      // Handle field:operator format
      if (key.includes(':')) {
        const lastColonIndex = key.lastIndexOf(':');
        const fieldName = key.slice(0, lastColonIndex);
        const operator = key.slice(lastColonIndex + 1);

        // Initialize field object if it doesn't exist
        if (!searchBody.filtering[fieldName]) {
          searchBody.filtering[fieldName] = {};
        }

        // Convert list operators to search operators and handle special cases
        let searchValue = value;
        if (operator === 'in' || operator === 'not_in') {
          // Split comma-separated values for IN operations
          searchValue = String(value)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }

        searchBody.filtering[fieldName][operator] = searchValue;
      } else {
        // Simple equality filter (case-insensitive for strings will be handled by search logic)
        searchBody.filtering[key] = value;
      }
    }
  }

  return searchBody;
}

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

      // Convert list query parameters to search body format
      const searchBody = convertListQueryToSearchBody(
        q,
        modelCfg,
        mergedOptions
      );

      // Create search options that match list behavior
      const searchOptions = {
        defaultPageSize,
        defaultOrderBy,
        defaultOrderDir,
        metaShowOrdering,
        id_mapping: idMapping,
        relation_id_mapping: relationIdMapping,
        pre,
        post,
      };

      // Execute the search operation with the converted parameters
      const payload = await executeSearchOperation(
        model,
        searchOptions,
        modelOptions,
        req,
        res,
        searchBody
      );

      // If search didn't send a response and we have a payload, modify it to match list format
      if (!res.headersSent && payload) {
        // Add list-specific meta fields if needed
        if (payload.meta && metaShowFilters && allowFiltering) {
          // Convert search filters back to list format for meta display if needed
          payload.meta.filters = {};
          if (searchBody.filtering) {
            for (const [key, value] of Object.entries(searchBody.filtering)) {
              if (typeof value === 'object' && !Array.isArray(value)) {
                // Convert back from search operator format to list format
                for (const [op, val] of Object.entries(value)) {
                  payload.meta.filters[`${key}:${op}`] = val;
                }
              } else {
                payload.meta.filters[key] = value;
              }
            }
          }
        }

        res.json(payload);
      }
    })
  );

  router.apialize = {};
  return router;
}

module.exports = list;
