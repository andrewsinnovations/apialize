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

const LIST_DEFAULTS = {
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
};

function extractValidPage(query) {
  const page = parseInt(query['api:page'], 10);
  if (isNaN(page) || page < 1) {
    return 1;
  }
  return page;
}

function calculateEffectivePageSize(modelCfg, listOptions) {
  if (Number.isInteger(modelCfg.page_size) && modelCfg.page_size > 0) {
    return modelCfg.page_size;
  }
  return listOptions.defaultPageSize;
}

function extractValidPageSize(query, effectivePageSize) {
  const pageSize = parseInt(query['api:page_size'], 10);
  if (isNaN(pageSize) || pageSize < 1) {
    return effectivePageSize;
  }
  return pageSize;
}

function setupPagingParameters(query, modelCfg, listOptions) {
  const page = extractValidPage(query);
  const effectivePageSize = calculateEffectivePageSize(modelCfg, listOptions);
  const pageSize = extractValidPageSize(query, effectivePageSize);

  return {
    page: page,
    size: pageSize,
  };
}

function extractRawOrderBy(query, modelCfg, allowOrdering) {
  if (allowOrdering) {
    return query['api:order_by'] || modelCfg.orderby;
  }
  return modelCfg.orderby;
}

function extractGlobalDirection(
  query,
  modelCfg,
  allowOrdering,
  defaultOrderDir
) {
  let direction;

  if (allowOrdering) {
    direction = query['api:order_dir'] || modelCfg.orderdir || defaultOrderDir;
  } else {
    direction = modelCfg.orderdir || defaultOrderDir;
  }

  return direction.toString().toUpperCase();
}

function parseOrderByField(field, globalDir) {
  const trimmed = field.toString().trim();
  if (!trimmed) {
    return null;
  }

  let columnName;
  let direction;

  if (trimmed.charAt(0) === '-') {
    columnName = trimmed.slice(1);
    direction = 'DESC';
  } else if (trimmed.charAt(0) === '+') {
    columnName = trimmed.slice(1);
    direction = 'ASC';
  } else {
    columnName = trimmed;
    if (globalDir === 'DESC') {
      direction = 'DESC';
    } else {
      direction = 'ASC';
    }
  }

  return {
    order_by: columnName,
    direction: direction,
  };
}

function buildOrderingArray(rawOrderBy, globalDir) {
  if (!rawOrderBy) {
    return null;
  }

  const splitFields = rawOrderBy.split(',');
  const orderingArray = [];

  for (let i = 0; i < splitFields.length; i++) {
    const field = splitFields[i];
    const parsedField = parseOrderByField(field, globalDir);
    if (parsedField) {
      orderingArray.push(parsedField);
    }
  }

  if (orderingArray.length > 0) {
    return orderingArray;
  }
  return null;
}

function setupOrderingParameters(query, modelCfg, listOptions) {
  const rawOrderBy = extractRawOrderBy(
    query,
    modelCfg,
    listOptions.allowOrdering
  );
  const globalDir = extractGlobalDirection(
    query,
    modelCfg,
    listOptions.allowOrdering,
    listOptions.defaultOrderDir
  );

  const orderingArray = buildOrderingArray(rawOrderBy, globalDir);

  if (orderingArray) {
    return orderingArray;
  }

  return [
    {
      order_by: listOptions.defaultOrderBy,
      direction: listOptions.defaultOrderDir,
    },
  ];
}

function processInOperatorValue(value) {
  const stringValue = String(value);
  const splitValues = stringValue.split(',');
  const trimmedValues = [];

  for (let i = 0; i < splitValues.length; i++) {
    const trimmed = splitValues[i].trim();
    if (trimmed.length > 0) {
      trimmedValues.push(trimmed);
    }
  }

  return trimmedValues;
}

function processFilterValue(operator, value) {
  if (operator === 'in' || operator === 'not_in') {
    return processInOperatorValue(value);
  }
  return value;
}

function processFieldOperatorFilter(key, value, filtering) {
  const lastColonIndex = key.lastIndexOf(':');
  const fieldName = key.slice(0, lastColonIndex);
  const operator = key.slice(lastColonIndex + 1);

  if (!filtering[fieldName]) {
    filtering[fieldName] = {};
  }

  const searchValue = processFilterValue(operator, value);
  filtering[fieldName][operator] = searchValue;
}

function setupFilteringParameters(query, allowFiltering) {
  const filtering = {};

  if (!allowFiltering) {
    return filtering;
  }

  const queryKeys = Object.keys(query);
  for (let i = 0; i < queryKeys.length; i++) {
    const key = queryKeys[i];
    const value = query[key];

    if (key.startsWith('api:')) {
      continue;
    }
    if (value === undefined) {
      continue;
    }

    if (key.includes(':')) {
      processFieldOperatorFilter(key, value, filtering);
    } else {
      filtering[key] = value;
    }
  }

  return filtering;
}

function convertListQueryToSearchBody(query, modelCfg, listOptions) {
  const searchBody = {
    filtering: {},
    ordering: null,
    paging: {},
  };

  searchBody.paging = setupPagingParameters(query, modelCfg, listOptions);
  searchBody.ordering = setupOrderingParameters(query, modelCfg, listOptions);
  searchBody.filtering = setupFilteringParameters(
    query,
    listOptions.allowFiltering
  );

  return searchBody;
}

function extractListOptions(options) {
  return Object.assign({}, LIST_DEFAULTS, options);
}

function extractIdMapping(mergedOptions) {
  return mergedOptions.id_mapping || 'id';
}

function filterMiddlewareFunctions(middleware) {
  const inline = [];
  for (let i = 0; i < middleware.length; i++) {
    const fn = middleware[i];
    if (typeof fn === 'function') {
      inline.push(fn);
    }
  }
  return inline;
}

function createFilteringMiddleware(allowFiltering) {
  return function (req, _res, next) {
    if (!allowFiltering) {
      req._apializeDisableQueryFilters = true;
    }
    next();
  };
}

function createSearchOptions(mergedOptions, idMapping) {
  return {
    defaultPageSize: mergedOptions.defaultPageSize,
    defaultOrderBy: mergedOptions.defaultOrderBy,
    defaultOrderDir: mergedOptions.defaultOrderDir,
    metaShowOrdering: mergedOptions.metaShowOrdering,
    id_mapping: idMapping,
    relation_id_mapping: mergedOptions.relation_id_mapping,
    pre: mergedOptions.pre,
    post: mergedOptions.post,
  };
}

function convertSearchFiltersToListFormat(searchBody) {
  const filters = {};

  if (!searchBody.filtering) {
    return filters;
  }

  const filteringKeys = Object.keys(searchBody.filtering);
  for (let i = 0; i < filteringKeys.length; i++) {
    const key = filteringKeys[i];
    const value = searchBody.filtering[key];

    if (typeof value === 'object' && !Array.isArray(value)) {
      const valueKeys = Object.keys(value);
      for (let j = 0; j < valueKeys.length; j++) {
        const op = valueKeys[j];
        const val = value[op];
        filters[`${key}:${op}`] = val;
      }
    } else {
      filters[key] = value;
    }
  }

  return filters;
}

function addListMetaFilters(
  payload,
  searchBody,
  metaShowFilters,
  allowFiltering
) {
  if (payload.meta && metaShowFilters && allowFiltering) {
    payload.meta.filters = convertSearchFiltersToListFormat(searchBody);
  }
}

function list(model, options, modelOptions) {
  if (!options) {
    options = {};
  }
  if (!modelOptions) {
    modelOptions = {};
  }

  ensureFn(model, 'findAndCountAll');

  const mergedOptions = extractListOptions(options);
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

  const idMapping = extractIdMapping(mergedOptions);
  const inline = filterMiddlewareFunctions(middleware);
  const router = express.Router({ mergeParams: true });
  const filteringMiddleware = createFilteringMiddleware(allowFiltering);

  router.get(
    '/',
    filteringMiddleware,
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const q = req.query || {};
      const modelCfg = (model && model.apialize) || {};

      const searchBody = convertListQueryToSearchBody(
        q,
        modelCfg,
        mergedOptions
      );
      const searchOptions = createSearchOptions(mergedOptions, idMapping);

      const payload = await executeSearchOperation(
        model,
        searchOptions,
        modelOptions,
        req,
        res,
        searchBody
      );

      if (!res.headersSent && payload) {
        addListMetaFilters(
          payload,
          searchBody,
          metaShowFilters,
          allowFiltering
        );
        res.json(payload);
      }
    })
  );

  router.apialize = {};
  return router;
}

module.exports = list;
