/**
 * Validates that provided data is not empty
 */
function validateDataNotEmpty(data, isPartial = false) {
  if (!data || typeof data !== 'object') {
    const error = new Error('Request body cannot be empty');
    error.name = 'ValidationError';
    error.statusCode = 400;
    throw error;
  }

  // For partial updates (PATCH), allow empty objects
  if (!isPartial && !Array.isArray(data) && Object.keys(data).length === 0) {
    const error = new Error('Request body cannot be empty');
    error.name = 'ValidationError';
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Validates enum fields in the data
 */
function validateEnumFields(model, data) {
  if (!model.rawAttributes) {
    return;
  }

  const items = Array.isArray(data) ? data : [data];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    if (!item || typeof item !== 'object') {
      continue;
    }

    for (const fieldName in item) {
      if (!item.hasOwnProperty(fieldName)) {
        continue;
      }

      const attribute = model.rawAttributes[fieldName];
      if (!attribute) {
        continue;
      }

      // Check if this is an enum field
      if (
        attribute.type &&
        attribute.type.values &&
        Array.isArray(attribute.type.values)
      ) {
        const value = item[fieldName];
        if (value !== null && value !== undefined) {
          if (!attribute.type.values.includes(value)) {
            const error = new Error(
              `Validation error: Field '${fieldName}' must be one of: ${attribute.type.values.join(', ')}`
            );
            error.name = 'ValidationError';
            error.statusCode = 400;
            throw error;
          }
        }
      }
    }
  }
}

/**
 * Validates data types for INTEGER and DECIMAL fields
 */
function validateDataTypes(model, data) {
  if (!model.rawAttributes) {
    return;
  }

  const items = Array.isArray(data) ? data : [data];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    if (!item || typeof item !== 'object') {
      continue;
    }

    for (const fieldName in item) {
      if (!item.hasOwnProperty(fieldName)) {
        continue;
      }

      const attribute = model.rawAttributes[fieldName];
      if (!attribute) {
        continue;
      }

      const value = item[fieldName];
      if (value === null || value === undefined) {
        continue;
      }

      // Check INTEGER fields
      if (
        attribute.type &&
        attribute.type.constructor &&
        attribute.type.constructor.name === 'INTEGER'
      ) {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          const error = new Error(
            `Validation error: Field '${fieldName}' must be an integer`
          );
          error.name = 'ValidationError';
          error.statusCode = 400;
          throw error;
        }
      }

      // Check DECIMAL/FLOAT fields
      if (
        attribute.type &&
        attribute.type.constructor &&
        (attribute.type.constructor.name === 'DECIMAL' ||
          attribute.type.constructor.name === 'FLOAT')
      ) {
        if (typeof value !== 'number') {
          const error = new Error(
            `Validation error: Field '${fieldName}' must be a number`
          );
          error.name = 'ValidationError';
          error.statusCode = 400;
          throw error;
        }
      }
    }
  }
}

/**
 * Validates data against a Sequelize model
 *
 * @param {Object} model - The Sequelize model to validate against
 * @param {Object|Array} data - The data to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.isPartial - Whether to do partial validation (for PATCH operations)
 * @returns {Promise} - Resolves if validation passes, rejects with validation errors if not
 */
async function validateData(model, data, options = {}) {
  const { isPartial = false } = options;

  try {
    // Check that data is not empty (allow empty for partial updates)
    validateDataNotEmpty(data, isPartial);

    // Validate enum fields
    validateEnumFields(model, data);

    // Validate data types
    validateDataTypes(model, data);

    // Handle bulk operations (arrays)
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item && typeof item === 'object') {
          // Create a temporary instance for validation without saving
          const instance = model.build(item);
          await instance.validate();
        }
      }
    } else if (
      data &&
      typeof data === 'object' &&
      Object.keys(data).length > 0
    ) {
      // Handle single object validation
      if (isPartial) {
        // For PATCH, validate only the fields being provided
        const fieldsToValidate = Object.keys(data);
        const instance = model.build(data);

        // Validate only the specified fields
        await instance.validate({ fields: fieldsToValidate });
      } else {
        // For other operations, validate the entire object
        const instance = model.build(data);
        await instance.validate();
      }
    }
  } catch (error) {
    // If it's already a validation error we threw, re-throw it
    if (error.name === 'ValidationError') {
      throw error;
    }

    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors.map((err) => ({
        field: err.path,
        message: err.message,
        value: err.value,
      }));

      const validationError = new Error('Validation failed');
      validationError.name = 'ValidationError';
      validationError.details = validationErrors;
      throw validationError;
    }

    // Handle other Sequelize errors that might occur during validation
    if (error.name && error.name.startsWith('Sequelize')) {
      const validationError = new Error(error.message || 'Validation error');
      validationError.name = 'ValidationError';
      validationError.details = [];
      throw validationError;
    }

    // For any other unexpected errors, re-throw them
    throw error;
  }
}

module.exports = {
  validateData,
};
