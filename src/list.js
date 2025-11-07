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
  disableSubqueryOnIncludeRequest: true,
  flattening: null,
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
  let direction = defaultOrderDir;

  if (modelCfg.orderdir) {
    direction = modelCfg.orderdir;
  }

  if (allowOrdering && query['api:order_dir']) {
    direction = query['api:order_dir'];
  }

  return direction.toString().toUpperCase();
}

function parseOrderByField(field, globalDir) {
  const trimmed = field.toString().trim();
  if (!trimmed) {
    return null;
  }

  const firstChar = trimmed.charAt(0);
  let columnName = trimmed;
  let direction = globalDir;

  if (firstChar === '-') {
    columnName = trimmed.slice(1);
    direction = 'DESC';
  } else if (firstChar === '+') {
    columnName = trimmed.slice(1);
    direction = 'ASC';
  } else {
    direction = globalDir === 'DESC' ? 'DESC' : 'ASC';
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

function isValidFilterKey(key, value) {
  const isApiKey = key.startsWith('api:');
  const hasUndefinedValue = value === undefined;

  return !isApiKey && !hasUndefinedValue;
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

    if (!isValidFilterKey(key, value)) {
      continue;
    }

    const hasOperator = key.includes(':');
    if (hasOperator) {
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
  const mergedOptions = {};
  const defaultKeys = Object.keys(LIST_DEFAULTS);

  for (let i = 0; i < defaultKeys.length; i++) {
    const key = defaultKeys[i];
    mergedOptions[key] = LIST_DEFAULTS[key];
  }

  if (options) {
    const optionKeys = Object.keys(options);
    for (let i = 0; i < optionKeys.length; i++) {
      const key = optionKeys[i];
      mergedOptions[key] = options[key];
    }
  }

  return mergedOptions;
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
  const searchOptions = {};

  searchOptions.defaultPageSize = mergedOptions.defaultPageSize;
  searchOptions.defaultOrderBy = mergedOptions.defaultOrderBy;
  searchOptions.defaultOrderDir = mergedOptions.defaultOrderDir;
  searchOptions.metaShowOrdering = mergedOptions.metaShowOrdering;
  searchOptions.id_mapping = idMapping;
  searchOptions.relation_id_mapping = mergedOptions.relation_id_mapping;
  searchOptions.disableSubqueryOnIncludeRequest =
    mergedOptions.disableSubqueryOnIncludeRequest;
  searchOptions.flattening = mergedOptions.flattening;
  searchOptions.pre = mergedOptions.pre;
  searchOptions.post = mergedOptions.post;

  return searchOptions;
}

function isOperatorObject(value) {
  return typeof value === 'object' && !Array.isArray(value) && value !== null;
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

    if (isOperatorObject(value)) {
      const valueKeys = Object.keys(value);
      for (let j = 0; j < valueKeys.length; j++) {
        const operator = valueKeys[j];
        const operatorValue = value[operator];
        filters[`${key}:${operator}`] = operatorValue;
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

function extractListConfiguration(options) {
  const mergedOptions = extractListOptions(options);

  return {
    mergedOptions: mergedOptions,
    middleware: mergedOptions.middleware,
    allowFiltering: mergedOptions.allowFiltering,
    allowOrdering: mergedOptions.allowOrdering,
    metaShowFilters: mergedOptions.metaShowFilters,
    metaShowOrdering: mergedOptions.metaShowOrdering,
    defaultPageSize: mergedOptions.defaultPageSize,
    defaultOrderBy: mergedOptions.defaultOrderBy,
    defaultOrderDir: mergedOptions.defaultOrderDir,
    id_mapping: mergedOptions.id_mapping,
    relationIdMapping: mergedOptions.relation_id_mapping,
    flattening: mergedOptions.flattening,
    pre: mergedOptions.pre,
    post: mergedOptions.post,
  };
}

async function processListRequest(model, config, modelOptions, req, res) {
  const query = req.query || {};
  const modelConfiguration = (model && model.apialize) || {};

  const searchBody = convertListQueryToSearchBody(
    query,
    modelConfiguration,
    config.mergedOptions
  );
  const idMapping = extractIdMapping(config.mergedOptions);
  const searchOptions = createSearchOptions(config.mergedOptions, idMapping);

  const payload = await executeSearchOperation(
    model,
    searchOptions,
    modelOptions,
    req,
    res,
    searchBody
  );

  const shouldSendResponse = !res.headersSent && payload;
  if (shouldSendResponse) {
    addListMetaFilters(
      payload,
      searchBody,
      config.metaShowFilters,
      config.allowFiltering
    );
    res.json(payload);
  }
}

function list(model, options, modelOptions) {
  const safeOptions = options || {};
  const safeModelOptions = modelOptions || {};

  ensureFn(model, 'findAndCountAll');

  const config = extractListConfiguration(safeOptions);
  const idMapping = extractIdMapping(config.mergedOptions);
  const inline = filterMiddlewareFunctions(config.middleware);
  const router = express.Router({ mergeParams: true });
  const filteringMiddleware = createFilteringMiddleware(config.allowFiltering);

  const middlewareList = ['/', filteringMiddleware, apializeContext];

  for (let i = 0; i < inline.length; i++) {
    middlewareList.push(inline[i]);
  }

  const handler = asyncHandler(async (req, res) => {
    await processListRequest(model, config, safeModelOptions, req, res);
  });

  middlewareList.push(handler);

  router.get.apply(router, middlewareList);

  router.apialize = {};
  return router;
}

module.exports = list;
