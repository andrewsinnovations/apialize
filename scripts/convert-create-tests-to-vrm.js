#!/usr/bin/env node

/**
 * Script to convert create*.test.js files from inline Sequelize models to VRM database
 *
 * Usage: node scripts/convert-create-tests-to-vrm.js [--dry-run] [--file <filename>]
 *
 * Options:
 *   --dry-run: Show changes without writing to files
 *   --file <filename>: Convert only the specified file
 *
 * Examples:
 *   node scripts/convert-create-tests-to-vrm.js --dry-run
 *   node scripts/convert-create-tests-to-vrm.js --file create.bulk.test.js
 *   node scripts/convert-create-tests-to-vrm.js
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileIndex = args.indexOf('--file');
const specificFile = fileIndex !== -1 ? args[fileIndex + 1] : null;

// Define test files to convert (excluding already converted ones)
const TEST_FILES = [
  'create.bulk.test.js',
  'create.errors.test.js',
  'create.hooks.test.js',
  'create.id-mapping.test.js',
  'create.middleware.test.js',
  'create.model-options.test.js',
  'create.relation-id-mapping.test.js',
  'create.relation-id-mapping-uuid.test.js',
  'create.request-body.test.js',
  'create.validation.test.js',
];

// VRM model mapping - maps common test model names to VRM equivalents
const MODEL_MAPPINGS = {
  Product: 'Part',
  Item: 'Part',
  User: 'Customer',
  Account: 'Customer',
  Category: 'Customer', // Can be adapted based on context
  Document: 'ServiceRecord',
  Report: 'ServiceRecord',
  Task: 'Part',
  Note: 'Part',
  Counter: 'Part',
  Widget: 'Part',
  Gadget: 'Part',
};

// VRM model field mappings
const FIELD_MAPPINGS = {
  Part: {
    common: ['partNumber', 'name', 'category', 'unitPrice'],
    sample: {
      partNumber: 'TEST-001',
      name: 'Test Part',
      category: 'engine',
      unitPrice: 99.99,
    },
  },
  Customer: {
    common: ['firstName', 'lastName', 'email'],
    sample: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
    },
  },
  Vehicle: {
    common: ['vin', 'make', 'model', 'year'],
    sample: {
      vin: '1HGBH41JXMN000001',
      make: 'Honda',
      model: 'Civic',
      year: 2024,
    },
  },
  ServiceRecord: {
    common: ['vehicleId', 'serviceType', 'description', 'serviceDate'],
    requiresParents: ['Vehicle', 'Customer'],
  },
};

function convertFile(filePath) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Converting: ${path.basename(filePath)}`);
  console.log('='.repeat(80));

  let content = fs.readFileSync(filePath, 'utf-8');
  let changes = 0;

  // Step 1: Update imports
  const oldImports =
    /const \{ Sequelize, DataTypes(?:, [^}]+)? \} = require\('sequelize'\);/g;
  if (oldImports.test(content)) {
    content = content.replace(
      /const \{ Sequelize, DataTypes(?:, [^}]+)? \} = require\('sequelize'\);\s*\n/g,
      ''
    );
    changes++;
    console.log('✓ Removed Sequelize imports');
  }

  // Add VRM imports if not present
  if (!content.includes("require('./fixtures/vrm-setup')")) {
    content = content.replace(
      /(const \{ create[^}]*\} = require\('\.\.\/src'\);)/,
      "$1\nconst { setupVrmDatabase, teardownVrmDatabase } = require('./fixtures/vrm-setup');"
    );
    changes++;
    console.log('✓ Added VRM setup imports');
  }

  // Step 2: Update describe block setup
  content = content.replace(
    /describe\([^{]+\{[\s\n]*let sequelize;[\s\n]*let app;[\s\n]*afterEach\(async \(\) => \{[\s\n]*if \(sequelize\) \{[\s\n]*await sequelize\.close\(\);[\s\n]*sequelize = null;[\s\n]*\}[\s\n]*\}\);/g,
    function (match) {
      const indent = match.match(/^(\s*)/)[1];
      const replacement = `describe(${match.match(/describe\(([^{]+)\{/)[1]}{
${indent}  let db;
${indent}  let app;

${indent}  afterEach(async () => {
${indent}    await teardownVrmDatabase(db);
${indent}  });`;
      changes++;
      return replacement;
    }
  );

  // Step 3: Replace inline sequelize instantiation and model definitions
  // This is complex, so we'll do pattern-based replacements

  // Pattern: sequelize = new Sequelize... followed by Model.define
  content = content.replace(
    /sequelize = new Sequelize\('sqlite::memory:', \{ logging: false \}\);[\s\S]*?await sequelize\.sync\(\{ force: true \}\);/g,
    function (match) {
      const testIndent = match.match(/^(\s*)/m)[1];
      return `${testIndent}db = await setupVrmDatabase({ loadData: false });`;
    }
  );

  // Step 4: Replace model variable declarations with destructuring from db.models
  // Look for patterns like: const Product = sequelize.define(...)
  const modelDefineRegex =
    /const (\w+) = sequelize\.define\(\s*'(\w+)',[\s\S]*?\);/g;
  const definedModels = [];
  let match;

  while ((match = modelDefineRegex.exec(content)) !== null) {
    definedModels.push(match[1]);
  }

  if (definedModels.length > 0) {
    console.log(`  Found models to replace: ${definedModels.join(', ')}`);
  }

  // Remove model definitions
  content = content.replace(
    /const \w+ = sequelize\.define\(\s*'\w+',[\s\S]*?\);[\s\n]*/g,
    ''
  );

  // Step 5: Add model destructuring after db setup
  content = content.replace(
    /(db = await setupVrmDatabase\(\{ loadData: false \}\);)/g,
    function (match, setup) {
      const testIndent = match.match(/^(\s*)/m)[1];
      // Find which test this is in to determine needed models
      const modelsNeeded = ['Part']; // Default to Part, can be enhanced
      return `${setup}\n${testIndent}const { ${modelsNeeded.join(', ')} } = db.models;`;
    }
  );

  // Step 6: Replace references to sequelize with db.sequelize
  content = content.replace(/\bsequelize\.count\(\)/g, 'db.sequelize.count()');
  content = content.replace(/\bsequelize\.query\(/g, 'db.sequelize.query(');

  // Step 7: Update test-specific model instantiation patterns
  // Replace Product with Part, User with Customer, etc.
  Object.entries(MODEL_MAPPINGS).forEach(([oldModel, newModel]) => {
    // Don't replace in comments or strings
    const regex = new RegExp(`\\b${oldModel}\\b(?!['"\\s]*:)`, 'g');
    const beforeCount = (content.match(regex) || []).length;
    if (beforeCount > 0) {
      content = content.replace(regex, newModel);
      console.log(
        `  Replaced ${beforeCount} occurrences of ${oldModel} with ${newModel}`
      );
      changes += beforeCount;
    }
  });

  // Step 8: Clean up any remaining sequelize references in comments
  content = content.replace(/\/\*\*[\s\S]*?\*\//g, function (comment) {
    return comment.replace(/sequelize/gi, 'database');
  });

  return { content, changes };
}

function main() {
  const testsDir = path.join(__dirname, '..', '__tests__');
  const filesToProcess = specificFile ? [specificFile] : TEST_FILES;

  let totalChanges = 0;
  let filesProcessed = 0;
  let filesSkipped = 0;

  console.log('\n' + '='.repeat(80));
  console.log('VRM Test Conversion Script');
  console.log('='.repeat(80));
  console.log(
    `Mode: ${dryRun ? 'DRY RUN (no files will be modified)' : 'WRITE'}`
  );
  console.log(`Files to process: ${filesToProcess.length}`);

  filesToProcess.forEach((filename) => {
    const filePath = path.join(testsDir, filename);

    if (!fs.existsSync(filePath)) {
      console.log(`\n⚠ Skipping ${filename} - file not found`);
      filesSkipped++;
      return;
    }

    const { content, changes } = convertFile(filePath);

    if (changes > 0) {
      if (!dryRun) {
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`\n✅ Updated ${filename} (${changes} changes)`);
      } else {
        console.log(`\n📋 Would update ${filename} (${changes} changes)`);
      }
      totalChanges += changes;
      filesProcessed++;
    } else {
      console.log(`\n⏭ No changes needed for ${filename}`);
      filesSkipped++;
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('Summary');
  console.log('='.repeat(80));
  console.log(`Files processed: ${filesProcessed}`);
  console.log(`Files skipped: ${filesSkipped}`);
  console.log(`Total changes: ${totalChanges}`);

  if (dryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✨ Conversion complete!');
    console.log(
      '\n⚠️  IMPORTANT: Review the changes and run tests to ensure correctness.'
    );
    console.log('Some test cases may need manual adjustment for:');
    console.log('  - Specific field names and validation rules');
    console.log('  - Model relationships and foreign keys');
    console.log('  - Test data that needs to match VRM schema');
  }
  console.log('='.repeat(80) + '\n');
}

// Run the script
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

module.exports = { convertFile, MODEL_MAPPINGS, FIELD_MAPPINGS };
