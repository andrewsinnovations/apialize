const Sequelize = require('sequelize');

function getModelAttributes(model) {
  if (!model || !model.rawAttributes) {
    return {};
  }
  return model.rawAttributes;
}

function validateColumnExists(model, columnName) {
  const attributes = getModelAttributes(model);
  return Object.prototype.hasOwnProperty.call(attributes, columnName);
}

function isValidDottedPath(dottedPath) {
  if (!dottedPath || typeof dottedPath !== 'string') {
    return false;
  }
  if (!dottedPath.includes('.')) {
    return false;
  }
  return true;
}

function isValidIncludesArray(includes) {
  if (!Array.isArray(includes) || includes.length === 0) {
    return false;
  }
  return true;
}

function findIncludeByAlias(includes, alias) {
  if (!Array.isArray(includes)) {
    return null;
  }

  for (let i = 0; i < includes.length; i++) {
    const include = includes[i];
    if (include && include.as === alias) {
      return include;
    }
  }
  return null;
}

function resolveIncludedAttribute(rootModel, includes, dottedPath) {
  if (!isValidDottedPath(dottedPath)) {
    return null;
  }
  if (!isValidIncludesArray(includes)) {
    return null;
  }

  const parts = dottedPath.split('.');
  const attrName = parts.pop();
  let currIncludes = includes;
  let currModel = rootModel;
  const aliasChain = [];
  const includeChain = [];

  for (let i = 0; i < parts.length; i++) {
    const alias = parts[i];
    const match = findIncludeByAlias(currIncludes, alias);
    if (!match || !match.model) {
      return null;
    }
    aliasChain.push(alias);
    currModel = match.model;
    currIncludes = match.include || [];
    includeChain.push({ model: match.model, as: alias });
  }

  const attrs = getModelAttributes(currModel);
  if (!Object.prototype.hasOwnProperty.call(attrs, attrName)) {
    return null;
  }

  return {
    foundModel: currModel,
    attribute: attrs[attrName],
    aliasPath: `${aliasChain.join('.')}.${attrName}`,
    aliasChain,
    includeChain,
  };
}

function isValidIntegerValue(value) {
  return !isNaN(parseInt(value, 10));
}

function isValidFloatValue(value) {
  return !isNaN(parseFloat(value));
}

function isValidBooleanValue(value) {
  const validBooleans = ['true', 'false', '1', '0', 'yes', 'no'];
  const stringValue = String(value).toLowerCase();
  return validBooleans.includes(stringValue);
}

function isValidDateValue(value) {
  return !isNaN(Date.parse(value));
}

function validateDataTypeByName(typeName, value) {
  if (typeName === 'integer' || typeName === 'bigint') {
    return isValidIntegerValue(value);
  }
  if (
    typeName === 'float' ||
    typeName === 'real' ||
    typeName === 'double' ||
    typeName === 'decimal'
  ) {
    return isValidFloatValue(value);
  }
  if (typeName === 'boolean') {
    return isValidBooleanValue(value);
  }
  if (typeName === 'date' || typeName === 'dateonly') {
    return isValidDateValue(value);
  }
  if (
    typeName === 'string' ||
    typeName === 'text' ||
    typeName === 'char' ||
    typeName === 'varchar'
  ) {
    return true;
  }
  return true;
}

function validateDataType(model, columnName, value) {
  const attributes = getModelAttributes(model);
  const attribute = attributes[columnName];

  if (!attribute || !attribute.type) {
    return true;
  }

  const dataType = attribute.type;
  const typeName = dataType.constructor.name.toLowerCase();

  try {
    return validateDataTypeByName(typeName, value);
  } catch (error) {
    return true;
  }
}

function extractValidPage(query) {
  const page = parseInt(query['api:page'], 10);
  if (isNaN(page) || page < 1) {
    return 1;
  }
  return page;
}

function calculateEffectivePageSize(modelCfg, defaultPageSize) {
  if (Number.isInteger(modelCfg.page_size) && modelCfg.page_size > 0) {
    return modelCfg.page_size;
  }
  return defaultPageSize;
}

function extractValidPageSize(query, effectivePageSize) {
  const pageSize = parseInt(query['api:page_size'], 10);
  if (isNaN(pageSize) || pageSize < 1) {
    return effectivePageSize;
  }
  return pageSize;
}

function setupPagination(req, query, modelCfg, defaultPageSize) {
  const page = extractValidPage(query);
  const effectivePageSize = calculateEffectivePageSize(
    modelCfg,
    defaultPageSize
  );
  const pageSize = extractValidPageSize(query, effectivePageSize);

  req.apialize.options.limit = pageSize;
  req.apialize.options.offset = (page - 1) * pageSize;

  return { page, pageSize };
}

function extractOrderByValue(query, modelCfg, allowOrdering) {
  if (allowOrdering) {
    return query['api:order_by'] || modelCfg.orderby;
  }
  return modelCfg.orderby;
}

function extractOrderDirection(query, modelCfg, allowOrdering) {
  let direction;
  if (allowOrdering) {
    direction = query['api:order_dir'] || modelCfg.orderdir || 'ASC';
  } else {
    direction = modelCfg.orderdir || 'ASC';
  }
  return direction.toString().toUpperCase();
}

function parseOrderByFields(rawOrderBy) {
  if (!rawOrderBy) {
    return [];
  }

  const splitFields = rawOrderBy.split(',');
  const fields = [];

  for (let i = 0; i < splitFields.length; i++) {
    const field = splitFields[i];
    const trimmed = field != null ? String(field).trim() : '';
    if (trimmed) {
      fields.push(trimmed);
    }
  }

  return fields;
}

function parseFieldDirection(field, globalDir) {
  if (!field) {
    return null;
  }

  let columnName;
  let direction;

  if (field.charAt(0) === '-') {
    columnName = field.slice(1);
    direction = 'DESC';
  } else if (field.charAt(0) === '+') {
    columnName = field.slice(1);
    direction = 'ASC';
  } else {
    columnName = field;
    if (globalDir === 'DESC') {
      direction = 'DESC';
    } else {
      direction = 'ASC';
    }
  }

  return { columnName, direction };
}

function getIncludesFromRequest(req) {
  if (req.apialize.options && Array.isArray(req.apialize.options.include)) {
    return req.apialize.options.include;
  }
  return [];
}

function sendBadRequestResponse(res, message) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(message);
  }
  res.status(400).json({ success: false, error: 'Bad request' });
}

function modelsMatch(mappingModel, foundModel) {
  if (mappingModel === foundModel) {
    return true;
  }

  const bothModelsExist = mappingModel && foundModel;
  if (!bothModelsExist) {
    return false;
  }

  const namesMatch = mappingModel.name === foundModel.name;
  if (namesMatch) {
    return true;
  }

  const tableNamesMatch = mappingModel.tableName === foundModel.tableName;
  return tableNamesMatch;
}

function findRelationMapping(relationIdMapping, foundModel) {
  if (!Array.isArray(relationIdMapping)) {
    return null;
  }

  for (let i = 0; i < relationIdMapping.length; i++) {
    const mapping = relationIdMapping[i];
    if (modelsMatch(mapping.model, foundModel)) {
      return mapping;
    }
  }
  return null;
}

function buildIncludeChainForOrder(resolved) {
  const hasIncludeChain = Array.isArray(resolved.includeChain);

  if (hasIncludeChain) {
    const chain = [];
    for (let i = 0; i < resolved.includeChain.length; i++) {
      const includeItem = resolved.includeChain[i];
      chain.push({ model: includeItem.model, as: includeItem.as });
    }
    return chain;
  }

  const parts = resolved.aliasPath.split('.');
  const aliasName = parts.slice(0, -1).join('.') || parts[0];

  return [
    {
      model: resolved.foundModel,
      as: aliasName,
    },
  ];
}

function applyIdMappingToAttribute(attr, relationIdMapping, foundModel) {
  if (attr !== 'id') {
    return attr;
  }

  const relationMapping = findRelationMapping(relationIdMapping, foundModel);
  const hasMappedIdField = relationMapping && relationMapping.id_field;

  return hasMappedIdField ? relationMapping.id_field : attr;
}

function buildOrderArrayFromResolved(resolved, attr, direction) {
  const chain = buildIncludeChainForOrder(resolved);
  const orderArray = [];

  for (let i = 0; i < chain.length; i++) {
    orderArray.push(chain[i]);
  }

  orderArray.push(attr);
  orderArray.push(direction);

  return orderArray;
}

function processFlattenedOrderField(
  columnName,
  direction,
  model,
  includes,
  req,
  res,
  relationIdMapping,
  flattening
) {
  const includePath = mapFlattenedFieldToIncludePath(columnName, flattening);
  if (!includePath) {
    return null;
  }

  const resolved = resolveIncludedAttribute(model, includes, includePath);
  if (!resolved) {
    const message = `[Apialize] Bad request: Flattened field '${columnName}' maps to invalid path '${includePath}' on model '${model.name}'. Query: ${req.originalUrl}`;
    sendBadRequestResponse(res, message);
    return false;
  }

  const parts = includePath.split('.');
  const originalAttr = parts[parts.length - 1];
  const mappedAttr = applyIdMappingToAttribute(
    originalAttr,
    relationIdMapping,
    resolved.foundModel
  );

  return buildOrderArrayFromResolved(resolved, mappedAttr, direction);
}

function processIncludedOrderField(
  columnName,
  direction,
  model,
  includes,
  req,
  res,
  relationIdMapping
) {
  const resolved = resolveIncludedAttribute(model, includes, columnName);
  if (!resolved) {
    const message = `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`;
    sendBadRequestResponse(res, message);
    return false;
  }

  const parts = columnName.split('.');
  const originalAttr = parts[parts.length - 1];
  const mappedAttr = applyIdMappingToAttribute(
    originalAttr,
    relationIdMapping,
    resolved.foundModel
  );

  return buildOrderArrayFromResolved(resolved, mappedAttr, direction);
}

function processSimpleOrderField(columnName, direction, model, req, res) {
  if (!validateColumnExists(model, columnName)) {
    const message = `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`;
    sendBadRequestResponse(res, message);
    return false;
  }
  return [columnName, direction];
}

function processOrderField(
  field,
  globalDir,
  model,
  includes,
  req,
  res,
  relationIdMapping,
  flattening
) {
  const parsedField = parseFieldDirection(field, globalDir);
  if (!parsedField) {
    return null;
  }

  const { columnName, direction } = parsedField;

  const isFlattenedColumn =
    flattening && isFlattenedField(columnName, flattening);
  if (isFlattenedColumn) {
    return processFlattenedOrderField(
      columnName,
      direction,
      model,
      includes,
      req,
      res,
      relationIdMapping,
      flattening
    );
  }

  const isIncludedColumn = columnName.includes('.');
  if (isIncludedColumn) {
    return processIncludedOrderField(
      columnName,
      direction,
      model,
      includes,
      req,
      res,
      relationIdMapping
    );
  }

  return processSimpleOrderField(columnName, direction, model, req, res);
}

function setupOrdering(
  req,
  res,
  model,
  query,
  modelCfg,
  allowOrdering,
  defaultOrderBy,
  defaultOrderDir,
  idMapping,
  relationIdMapping,
  flattening
) {
  const rawOrderBy = extractOrderByValue(query, modelCfg, allowOrdering);
  const globalDir = extractOrderDirection(query, modelCfg, allowOrdering);

  if (rawOrderBy) {
    const fields = parseOrderByFields(rawOrderBy);
    const order = [];
    const includes = getIncludesFromRequest(req);

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) {
        continue;
      }

      const orderEntry = processOrderField(
        field,
        globalDir,
        model,
        includes,
        req,
        res,
        relationIdMapping,
        flattening
      );
      if (orderEntry === false) {
        return false;
      }
      if (orderEntry) {
        order.push(orderEntry);
      }
    }

    if (order.length) {
      req.apialize.options.order = order;
    }
  }

  if (!req.apialize.options.order) {
    let effectiveDefaultOrderBy = defaultOrderBy;
    if (defaultOrderBy === 'id' && idMapping) {
      effectiveDefaultOrderBy = idMapping;
    }
    req.apialize.options.order = [[effectiveDefaultOrderBy, defaultOrderDir]];
  }

  return true;
}

function getSequelizeOpFromModel(model) {
  if (!model || !model.sequelize) {
    return null;
  }

  if (model.sequelize.constructor && model.sequelize.constructor.Op) {
    return model.sequelize.constructor.Op;
  }

  if (model.sequelize.Sequelize && model.sequelize.Sequelize.Op) {
    return model.sequelize.Sequelize.Op;
  }

  return null;
}

function getSequelizeOp(model) {
  const opFromModel = getSequelizeOpFromModel(model);
  if (opFromModel) {
    return opFromModel;
  }

  try {
    return require('sequelize').Op;
  } catch (error) {
    return {};
  }
}

function getFilteringIncludes(req) {
  if (req.apialize.options && req.apialize.options.include) {
    return req.apialize.options.include;
  }
  return [];
}

function getDatabaseDialect(model) {
  if (
    model &&
    model.sequelize &&
    typeof model.sequelize.getDialect === 'function'
  ) {
    return model.sequelize.getDialect();
  }
  return null;
}

function getCaseInsensitiveOperators(Op, dialect) {
  const CI = dialect === 'postgres' ? Op.iLike || Op.like : Op.like;
  const CInot = dialect === 'postgres' ? Op.notILike || Op.notLike : Op.notLike;
  return { CI, CInot };
}

function parseFilterKey(key) {
  let rawKey = key;
  let operator = null;

  if (rawKey.includes(':')) {
    const idx = rawKey.lastIndexOf(':');
    operator = rawKey.slice(idx + 1);
    rawKey = rawKey.slice(0, idx);
  }

  return { rawKey, operator };
}

function shouldSkipFilterKey(key, value) {
  const isApiKey = key.startsWith('api:');
  const hasUndefinedValue = value === undefined;
  return isApiKey || hasUndefinedValue;
}

function createOperatorMap(Op, CI, CInot) {
  return {
    eq: Op.eq,
    '=': Op.eq,
    ieq: CI,
    neq: Op.ne,
    '!=': Op.ne,
    gt: Op.gt,
    '>': Op.gt,
    gte: Op.gte,
    '>=': Op.gte,
    lt: Op.lt,
    '<': Op.lt,
    lte: Op.lte,
    '<=': Op.lte,
    in: Op.in,
    not_in: Op.notIn,
    contains: Op.like,
    icontains: CI,
    not_contains: Op.notLike,
    not_icontains: CInot,
    starts_with: Op.like,
    ends_with: Op.like,
    not_starts_with: Op.notLike,
    not_ends_with: Op.notLike,
    is_true: Op.eq,
    is_false: Op.eq,
  };
}

function getOperatorValue(operator, value) {
  if (operator === 'contains' || operator === 'not_contains') {
    return `%${value}%`;
  }
  if (operator === 'icontains' || operator === 'not_icontains') {
    return `%${value}%`;
  }
  if (operator === 'starts_with' || operator === 'not_starts_with') {
    return `${value}%`;
  }
  if (operator === 'ends_with' || operator === 'not_ends_with') {
    return `%${value}`;
  }
  if (operator === 'is_true') {
    return true;
  }
  if (operator === 'is_false') {
    return false;
  }
  if (operator === 'in' || operator === 'not_in') {
    return String(value)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return value;
}

function isStringType(attribute) {
  if (!attribute || !attribute.type || !attribute.type.constructor) {
    return false;
  }

  const typeName = String(attribute.type.constructor.name).toLowerCase();
  const stringTypes = ['string', 'text', 'char', 'varchar'];
  return stringTypes.includes(typeName);
}

function setupFiltering(
  req,
  res,
  model,
  query,
  allowFiltering,
  relationIdMapping,
  flattening
) {
  let appliedFiltersMeta = {};
  let appliedFiltersDb = {};

  if (!allowFiltering) {
    return appliedFiltersMeta;
  }

  const includes = getFilteringIncludes(req);
  const Op = getSequelizeOp(model);
  const dialect = getDatabaseDialect(model);
  const { CI, CInot } = getCaseInsensitiveOperators(Op, dialect);
  const opMap = createOperatorMap(Op, CI, CInot);

  function processFlattenedFilterField(
    rawKey,
    flattening,
    model,
    includes,
    req,
    res
  ) {
    const includePath = mapFlattenedFieldToIncludePath(rawKey, flattening);
    if (!includePath) {
      return null;
    }

    const resolved = resolveIncludedAttribute(model, includes, includePath);
    if (!resolved) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[Apialize] Bad request: Flattened field '${rawKey}' maps to invalid path '${includePath}' on model '${model.name}'. Query: ${req.originalUrl}`
        );
      }
      res.status(400).json({ success: false, error: 'Bad request' });
      return false;
    }

    return {
      outKey: `$${resolved.aliasPath}$`,
      attribute: resolved.attribute,
      targetModel: resolved.foundModel,
    };
  }

  function buildMappedAliasPath(resolved, actualColumn) {
    const aliasPrefix = resolved.aliasPath.split('.').slice(0, -1).join('.');
    return aliasPrefix ? `${aliasPrefix}.${actualColumn}` : actualColumn;
  }

  function processIncludedFilterField(
    rawKey,
    model,
    includes,
    relationIdMapping,
    req,
    res
  ) {
    const resolved = resolveIncludedAttribute(model, includes, rawKey);
    if (!resolved) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[Apialize] Bad request: Invalid filter column '${rawKey}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`
        );
      }
      res.status(400).json({ success: false, error: 'Bad request' });
      return false;
    }

    const parts = rawKey.split('.');
    const originalColumn = parts[parts.length - 1];

    // Use the same applyIdMappingToAttribute logic as ordering
    const mappedAttr = applyIdMappingToAttribute(
      originalColumn,
      relationIdMapping,
      resolved.foundModel
    );

    // If the attribute was mapped to a different field, rebuild the alias path
    if (mappedAttr !== originalColumn) {
      const newAliasPath = buildMappedAliasPath(resolved, mappedAttr);
      const attrs = getModelAttributes(resolved.foundModel);

      return {
        outKey: `$${newAliasPath}$`,
        attribute: attrs && attrs[mappedAttr],
        targetModel: resolved.foundModel,
      };
    }

    return {
      outKey: `$${resolved.aliasPath}$`,
      attribute: resolved.attribute,
      targetModel: resolved.foundModel,
    };
  }

  function isForeignKeyWithReverseMapping(fieldName, model, relationIdMapping) {
    if (!Array.isArray(relationIdMapping) || !model || !model.associations) {
      return false;
    }

    const associationNames = Object.keys(model.associations);
    for (let i = 0; i < associationNames.length; i++) {
      const association = model.associations[associationNames[i]];

      if (
        association.associationType === 'BelongsTo' &&
        association.foreignKey === fieldName
      ) {
        const targetModel = association.target;
        const mapping = relationIdMapping.find((m) => {
          if (m.model === targetModel) return true;
          if (m.model && targetModel) {
            if (m.model.name === targetModel.name) return true;
            if (m.model.tableName === targetModel.tableName) return true;
          }
          return false;
        });

        if (mapping && mapping.id_field) {
          return true;
        }
      }
    }

    return false;
  }

  function processSimpleFilterField(rawKey, model, req, res) {
    if (!validateColumnExists(model, rawKey)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[Apialize] Bad request: Invalid filter column '${rawKey}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`
        );
      }
      res.status(400).json({ success: false, error: 'Bad request' });
      return false;
    }

    return {
      outKey: rawKey,
      attribute: getModelAttributes(model)[rawKey],
      targetModel: model,
    };
  }

  function resolveFilterField(
    rawKey,
    model,
    includes,
    relationIdMapping,
    flattening,
    req,
    res
  ) {
    const isFlattenedColumn =
      flattening && isFlattenedField(rawKey, flattening);
    if (isFlattenedColumn) {
      return processFlattenedFilterField(
        rawKey,
        flattening,
        model,
        includes,
        req,
        res
      );
    }

    const isIncludedColumn = rawKey.includes('.');
    if (isIncludedColumn) {
      return processIncludedFilterField(
        rawKey,
        model,
        includes,
        relationIdMapping,
        req,
        res
      );
    }

    return processSimpleFilterField(rawKey, model, req, res);
  }

  const queryKeys = Object.keys(query);
  for (let i = 0; i < queryKeys.length; i++) {
    const key = queryKeys[i];
    const value = query[key];

    if (shouldSkipFilterKey(key, value)) {
      continue;
    }

    const { rawKey, operator } = parseFilterKey(key);
    const fieldInfo = resolveFilterField(
      rawKey,
      model,
      includes,
      relationIdMapping,
      flattening,
      req,
      res
    );

    if (fieldInfo === false) {
      return false;
    }

    if (!fieldInfo) {
      continue;
    }

    const { outKey, attribute, targetModel } = fieldInfo;

    // Skip FK fields with reverse mapping - they'll be handled by search processor
    const isReverseMappedFK = isForeignKeyWithReverseMapping(
      rawKey,
      model,
      relationIdMapping
    );
    console.log(
      `[FK CHECK] rawKey=${rawKey}, isReverseMappedFK=${isReverseMappedFK}, relationIdMapping=`,
      relationIdMapping
    );
    if (isReverseMappedFK) {
      continue;
    }

    function validateFilterValue(
      attribute,
      value,
      rawKey,
      targetModel,
      req,
      res
    ) {
      const hasAttributeType = attribute && attribute.type;
      const isValidType = hasAttributeType
        ? validateDataType({ rawAttributes: { tmp: attribute } }, 'tmp', value)
        : true;

      if (!isValidType) {
        if (process.env.NODE_ENV === 'development') {
          const modelName =
            targetModel && targetModel.name ? targetModel.name : 'Model';
          console.warn(
            `[Apialize] Bad request: Invalid filter value '${value}' is not compatible with column '${rawKey}' data type on model '${modelName}'. Query: ${req.originalUrl}`
          );
        }
        res.status(400).json({ success: false, error: 'Bad request' });
        return false;
      }
      return true;
    }

    function applyDefaultEqualityFilter(
      outKey,
      value,
      attribute,
      CI,
      appliedFiltersMeta,
      appliedFiltersDb
    ) {
      if (isStringType(attribute)) {
        appliedFiltersMeta[outKey] = value;
        appliedFiltersDb[outKey] = { [CI]: value };
      } else {
        appliedFiltersMeta[outKey] = value;
        appliedFiltersDb[outKey] = value;
      }
    }

    function applyOperatorFilter(
      outKey,
      operator,
      value,
      opMap,
      appliedFiltersMeta,
      appliedFiltersDb,
      rawKey,
      req,
      res
    ) {
      if (!Object.prototype.hasOwnProperty.call(opMap, operator)) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[Apialize] Bad request: Invalid operator '${operator}' for filter '${rawKey}'. Query: ${req.originalUrl}`
          );
        }
        res.status(400).json({ success: false, error: 'Bad request' });
        return false;
      }

      const opSymbol = opMap[operator];
      const opValue = getOperatorValue(operator, value);

      const existingMeta = appliedFiltersMeta[outKey] || {};
      const existingDb = appliedFiltersDb[outKey] || {};

      const newMeta = {};
      const metaKeys = Object.keys(existingMeta);
      for (let i = 0; i < metaKeys.length; i++) {
        const key = metaKeys[i];
        newMeta[key] = existingMeta[key];
      }
      newMeta[opSymbol] = opValue;

      const newDb = {};
      const dbKeys = Object.keys(existingDb);
      for (let i = 0; i < dbKeys.length; i++) {
        const key = dbKeys[i];
        newDb[key] = existingDb[key];
      }
      newDb[opSymbol] = opValue;

      appliedFiltersMeta[outKey] = newMeta;
      appliedFiltersDb[outKey] = newDb;

      return true;
    }

    if (!validateFilterValue(attribute, value, rawKey, targetModel, req, res)) {
      return false;
    }

    if (!operator) {
      applyDefaultEqualityFilter(
        outKey,
        value,
        attribute,
        CI,
        appliedFiltersMeta,
        appliedFiltersDb
      );
    } else {
      if (
        !applyOperatorFilter(
          outKey,
          operator,
          value,
          opMap,
          appliedFiltersMeta,
          appliedFiltersDb,
          rawKey,
          req,
          res
        )
      ) {
        return false;
      }
    }
  }

  function mergeFiltersIntoWhere(appliedFiltersDb, req) {
    const hasFiltersToApply = Object.keys(appliedFiltersDb).length > 0;
    if (!hasFiltersToApply) {
      return;
    }

    const existingWhere = req.apialize.options.where || {};
    const mergedWhere = {};

    const existingKeys = Object.keys(existingWhere);
    for (let i = 0; i < existingKeys.length; i++) {
      const key = existingKeys[i];
      mergedWhere[key] = existingWhere[key];
    }

    const appliedKeys = Object.keys(appliedFiltersDb);
    for (let i = 0; i < appliedKeys.length; i++) {
      const key = appliedKeys[i];
      mergedWhere[key] = appliedFiltersDb[key];
    }

    req.apialize.options.where = mergedWhere;
  }

  mergeFiltersIntoWhere(appliedFiltersDb, req);
  return appliedFiltersMeta;
}

function convertResultRowsToPlainObjects(resultRows) {
  if (!Array.isArray(resultRows)) {
    return resultRows;
  }

  const rows = [];
  for (let i = 0; i < resultRows.length; i++) {
    const r = resultRows[i];
    if (r && typeof r.get === 'function') {
      rows.push(r.get({ plain: true }));
    } else {
      rows.push(r);
    }
  }
  return rows;
}

function createDefaultNormalizeFunction() {
  return function (x) {
    return x;
  };
}

async function buildResponse(
  result,
  page,
  pageSize,
  appliedFilters,
  metaShowFilters,
  metaShowOrdering,
  allowFiltering,
  req,
  idMapping,
  normalizeRows,
  flattening
) {
  const rows = convertResultRowsToPlainObjects(result.rows);
  const normFn = normalizeRows || createDefaultNormalizeFunction();
  let normalizedRows = await normFn(rows, idMapping);

  // Apply flattening if configured
  if (flattening) {
    normalizedRows = flattenResponseData(normalizedRows, flattening);
  }

  const totalPages = Math.max(1, Math.ceil(result.count / pageSize));

  function cleanFieldName(field) {
    const isWrappedField =
      typeof field === 'string' && field.startsWith('$') && field.endsWith('$');
    return isWrappedField ? field.slice(1, -1) : field;
  }

  function findLastStringIndex(orderArray) {
    for (let j = orderArray.length - 2; j >= 0; j--) {
      if (typeof orderArray[j] === 'string') {
        return j;
      }
    }
    return -1;
  }

  function extractAliasesFromOrderArray(orderArray, attrIndex) {
    const aliases = [];
    for (let k = 0; k < attrIndex; k++) {
      const segment = orderArray[k];
      const hasAlias = segment && typeof segment === 'object' && segment.as;
      if (hasAlias) {
        aliases.push(segment.as);
      }
    }
    return aliases;
  }

  function processOrderArrayEntry(orderEntry) {
    if (Array.isArray(orderEntry)) {
      const direction = (orderEntry[orderEntry.length - 1] || 'ASC')
        .toString()
        .toUpperCase();
      const attrIndex = findLastStringIndex(orderEntry);

      if (attrIndex === 0) {
        const field = cleanFieldName(orderEntry[0]);
        return [field, direction];
      }

      if (attrIndex > 0) {
        const attr = orderEntry[attrIndex];
        const aliases = extractAliasesFromOrderArray(orderEntry, attrIndex);
        const field = aliases.length ? `${aliases.join('.')}.${attr}` : attr;
        return [field, direction];
      }

      return orderEntry;
    }

    if (typeof orderEntry === 'string') {
      return [orderEntry, 'ASC'];
    }

    return orderEntry;
  }

  function buildOrderOutput(req) {
    const hasOrder = Array.isArray(req.apialize.options.order);
    if (!hasOrder) {
      return [];
    }

    const orderOut = [];
    for (let i = 0; i < req.apialize.options.order.length; i++) {
      const orderEntry = req.apialize.options.order[i];
      const processedEntry = processOrderArrayEntry(orderEntry);
      orderOut.push(processedEntry);
    }
    return orderOut;
  }

  function buildMetaObject(
    page,
    pageSize,
    totalPages,
    count,
    metaShowOrdering,
    metaShowFilters,
    orderOut,
    appliedFilters,
    allowFiltering
  ) {
    const meta = {
      paging: {
        page: page,
        size: pageSize,
        total_pages: totalPages,
        count: count,
      },
    };

    if (metaShowOrdering && orderOut) {
      // Convert from [[field, direction], ...] to [{order_by, direction}, ...]
      meta.ordering = orderOut.map((entry) => ({
        order_by: entry[0],
        direction: entry[1],
      }));
    }

    if (metaShowFilters) {
      meta.filtering = allowFiltering ? appliedFilters : {};
    }

    return meta;
  }

  const orderOut = metaShowOrdering ? buildOrderOutput(req) : undefined;
  const meta = buildMetaObject(
    page,
    pageSize,
    totalPages,
    result.count,
    metaShowOrdering,
    metaShowFilters,
    orderOut,
    appliedFilters,
    allowFiltering
  );

  return {
    success: true,
    meta: meta,
    data: normalizedRows,
  };
}

function normalizeFlatteningConfig(flattening) {
  if (!flattening) {
    return [];
  }

  // If it's already an array, return as-is
  if (Array.isArray(flattening)) {
    return flattening;
  }

  // If it's a single object, wrap it in an array
  return [flattening];
}

function validateSingleFlatteningConfig(flatteningConfig, model, includes) {
  if (!flatteningConfig.model || !flatteningConfig.as) {
    return {
      isValid: false,
      error: 'Flattening config must specify model and as',
    };
  }

  // Check if the specified alias exists in includes
  const includeFound = findIncludeByAlias(includes, flatteningConfig.as);
  if (!includeFound) {
    // Check if there's a conflicting include with the same model but different alias
    const hasConflictingInclude = includes.some(
      (inc) =>
        inc.model === flatteningConfig.model && inc.as !== flatteningConfig.as
    );

    if (hasConflictingInclude) {
      return {
        isValid: false,
        error: `Flattening alias '${flatteningConfig.as}' not found in includes, but model is included with a different alias`,
      };
    }

    // Auto-create include from flattening config
    // Start with model and as (required fields)
    const autoInclude = {
      model: flatteningConfig.model,
      as: flatteningConfig.as,
    };

    // Add all standard Sequelize include options if present in flattening config
    // Note: 'attributes' from flattening is for flattening config only, not Sequelize include
    const includeOptions = [
      'association',
      'where',
      'or',
      'on',
      'required',
      'right',
      'separate',
      'limit',
      'through',
      'include',
      'duplicating',
      'paranoid',
      'subQuery',
      'order',
      'having',
      'group',
    ];

    for (let i = 0; i < includeOptions.length; i++) {
      const option = includeOptions[i];
      if (flatteningConfig.hasOwnProperty(option)) {
        autoInclude[option] = flatteningConfig[option];
      }
    }

    // Set required to true by default if not explicitly specified
    if (!autoInclude.hasOwnProperty('required')) {
      autoInclude.required = true;
    }

    includes.push(autoInclude);
    return { isValid: true, includeFound: autoInclude, autoCreated: true };
  }

  // Validate that the model matches
  if (includeFound.model !== flatteningConfig.model) {
    return {
      isValid: false,
      error: `Flattening model does not match included model for alias '${flatteningConfig.as}'`,
    };
  }

  return { isValid: true, includeFound };
}

function validateFlatteningConfig(flattening, model, includes) {
  if (!flattening) {
    return { isValid: true };
  }

  const flatteningConfigs = normalizeFlatteningConfig(flattening);
  let anyAutoCreated = false;

  for (let i = 0; i < flatteningConfigs.length; i++) {
    const config = flatteningConfigs[i];
    const validation = validateSingleFlatteningConfig(config, model, includes);

    if (!validation.isValid) {
      return validation;
    }

    if (validation.autoCreated) {
      anyAutoCreated = true;
    }
  }

  return { isValid: true, autoCreated: anyAutoCreated };
}

function buildFlatteningAttributeMap(flattening) {
  if (!flattening || !flattening.attributes) {
    return {};
  }

  const attributeMap = {};
  for (let i = 0; i < flattening.attributes.length; i++) {
    const attr = flattening.attributes[i];
    if (typeof attr === 'string') {
      // Simple string attribute
      attributeMap[attr] = attr;
    } else if (Array.isArray(attr) && attr.length === 2) {
      // Array format: [sourceAttribute, targetAlias]
      attributeMap[attr[0]] = attr[1];
    }
  }
  return attributeMap;
}

function isFlattenedField(field, flattening) {
  if (!flattening || !field) {
    return false;
  }

  const flatteningConfigs = normalizeFlatteningConfig(flattening);

  for (let i = 0; i < flatteningConfigs.length; i++) {
    const config = flatteningConfigs[i];
    const attributeMap = buildFlatteningAttributeMap(config);

    // Check if field matches any target alias (renamed field)
    // Only check values, not keys, to avoid collision with main model fields
    const isTargetAlias = Object.values(attributeMap).includes(field);

    if (isTargetAlias) {
      return true;
    }
  }

  return false;
}

function mapFlattenedFieldToIncludePath(field, flattening) {
  if (!flattening || !field) {
    return null;
  }

  const flatteningConfigs = normalizeFlatteningConfig(flattening);

  for (let i = 0; i < flatteningConfigs.length; i++) {
    const config = flatteningConfigs[i];
    const attributeMap = buildFlatteningAttributeMap(config);

    // If field is a target alias, find the source attribute
    for (const [sourceAttr, targetAlias] of Object.entries(attributeMap)) {
      if (targetAlias === field) {
        return `${config.as}.${sourceAttr}`;
      }
    }

    // If field is a source attribute
    if (attributeMap[field]) {
      return `${config.as}.${field}`;
    }
  }

  return null;
}

function getIncludedDataForFlattening(rowData, alias) {
  if (!rowData[alias]) {
    return null;
  }

  let includedData = rowData[alias];

  const isArrayData = Array.isArray(includedData);
  if (isArrayData) {
    const hasItems = includedData.length > 0;
    includedData = hasItems ? includedData[0] : null;
  }

  return includedData;
}

function applyAttributeMapping(flattenedRow, includedData, attributeMap) {
  const attributeEntries = Object.entries(attributeMap);

  for (let i = 0; i < attributeEntries.length; i++) {
    const [sourceAttr, targetField] = attributeEntries[i];
    const hasSourceAttribute = includedData.hasOwnProperty(sourceAttr);

    if (hasSourceAttribute) {
      flattenedRow[targetField] = includedData[sourceAttr];
    }
  }
}

function flattenSingleRow(row, attributeMap, alias) {
  if (!row || typeof row !== 'object') {
    return row;
  }

  const flattenedRow = {};
  const rowKeys = Object.keys(row);

  for (let i = 0; i < rowKeys.length; i++) {
    const key = rowKeys[i];
    flattenedRow[key] = row[key];
  }

  const includedData = getIncludedDataForFlattening(row, alias);

  if (includedData && typeof includedData === 'object') {
    applyAttributeMapping(flattenedRow, includedData, attributeMap);
  }

  delete flattenedRow[alias];
  return flattenedRow;
}

function flattenResponseData(rows, flattening) {
  if (!flattening || !Array.isArray(rows)) {
    return rows;
  }

  const flatteningConfigs = normalizeFlatteningConfig(flattening);

  let processedRows = rows;

  // Apply each flattening config sequentially
  for (let i = 0; i < flatteningConfigs.length; i++) {
    const config = flatteningConfigs[i];
    const attributeMap = buildFlatteningAttributeMap(config);
    const alias = config.as;

    const flattenedRows = [];
    for (let j = 0; j < processedRows.length; j++) {
      const row = processedRows[j];
      const flattenedRow = flattenSingleRow(row, attributeMap, alias);
      flattenedRows.push(flattenedRow);
    }

    processedRows = flattenedRows;
  }

  return processedRows;
}

module.exports = {
  getModelAttributes,
  validateColumnExists,
  resolveIncludedAttribute,
  validateDataType,
  setupPagination,
  setupOrdering,
  setupFiltering,
  buildResponse,
  validateFlatteningConfig,
  normalizeFlatteningConfig,
  buildFlatteningAttributeMap,
  isFlattenedField,
  mapFlattenedFieldToIncludePath,
  flattenResponseData,
};
