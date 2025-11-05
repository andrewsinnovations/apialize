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
