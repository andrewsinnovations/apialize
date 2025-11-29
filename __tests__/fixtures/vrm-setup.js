const { createVrmDatabase } = require('./vrm-database');
const { loadSampleData, clearSampleData } = require('./vrm-sample-data');

/**
 * Sets up a complete VRM test database with models and sample data.
 * This is the main function to use in your tests.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.logging - Enable Sequelize logging (default: false)
 * @param {boolean} options.loadData - Load sample data automatically (default: true)
 * @returns {Promise<Object>} Object containing sequelize instance, models, and data
 *
 * @example
 * // In your test file:
 * const { setupVrmDatabase } = require('./fixtures/vrm-setup');
 *
 * describe('My Test Suite', () => {
 *   let db;
 *
 *   beforeEach(async () => {
 *     db = await setupVrmDatabase();
 *   });
 *
 *   afterEach(async () => {
 *     await db.sequelize.close();
 *   });
 *
 *   test('should access customer data', async () => {
 *     const customer = await db.models.Customer.findByPk(db.data.customers[0].id);
 *     expect(customer.firstName).toBe('John');
 *   });
 * });
 */
async function setupVrmDatabase(options = {}) {
  const { logging = false, loadData = true } = options;

  // Create database and models
  const { sequelize, models } = createVrmDatabase({ logging });

  // Sync all models to create tables
  await sequelize.sync({ force: true });

  // Load sample data if requested
  let data = null;
  if (loadData) {
    data = await loadSampleData(models);
  }

  return {
    sequelize,
    models,
    data,
  };
}

/**
 * Sets up VRM database without sample data.
 * Useful when you want to create your own test data.
 *
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Object containing sequelize instance and models
 *
 * @example
 * const { setupVrmDatabaseEmpty } = require('./fixtures/vrm-setup');
 *
 * describe('Custom Data Test', () => {
 *   let db;
 *
 *   beforeEach(async () => {
 *     db = await setupVrmDatabaseEmpty();
 *     // Create your own test data here
 *   });
 *
 *   afterEach(async () => {
 *     await db.sequelize.close();
 *   });
 * });
 */
async function setupVrmDatabaseEmpty(options = {}) {
  return setupVrmDatabase({ ...options, loadData: false });
}

/**
 * Tears down the VRM database by closing the connection.
 *
 * @param {Object} db - Database object from setupVrmDatabase
 * @returns {Promise<void>}
 */
async function teardownVrmDatabase(db) {
  if (db && db.sequelize) {
    await db.sequelize.close();
  }
}

/**
 * Resets the VRM database by clearing all data and optionally reloading sample data.
 * Useful for tests that need a fresh data state without recreating the entire database.
 *
 * @param {Object} db - Database object from setupVrmDatabase
 * @param {boolean} reloadData - Whether to reload sample data after clearing (default: true)
 * @returns {Promise<Object>} Updated data object (or null if reloadData is false)
 */
async function resetVrmDatabase(db, reloadData = true) {
  await clearSampleData(db.models);

  if (reloadData) {
    db.data = await loadSampleData(db.models);
    return db.data;
  }

  db.data = null;
  return null;
}

module.exports = {
  setupVrmDatabase,
  setupVrmDatabaseEmpty,
  teardownVrmDatabase,
  resetVrmDatabase,
};
