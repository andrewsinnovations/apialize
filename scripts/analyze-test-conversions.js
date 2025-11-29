#!/usr/bin/env node

/**
 * Manual Conversion Helper - Analyzes test files and provides specific guidance
 * for converting to VRM database models
 *
 * Usage: node scripts/analyze-test-conversions.js <test-file>
 * Example: node scripts/analyze-test-conversions.js create.bulk.test.js
 */

const fs = require('fs');
const path = require('path');

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);

  console.log('\n' + '='.repeat(80));
  console.log(`Analysis: ${filename}`);
  console.log('='.repeat(80));

  // Analyze model definitions
  const modelDefines = content.matchAll(
    /const (\w+) = sequelize\.define\(\s*'(\w+)',\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g
  );
  const models = [];

  for (const match of modelDefines) {
    const [, varName, modelName, fields] = match;
    models.push({ varName, modelName, fields });
  }

  console.log(`\n📊 Models Found: ${models.length}`);
  console.log('─'.repeat(80));

  models.forEach(({ varName, modelName, fields }) => {
    console.log(`\n${varName} (${modelName})`);

    // Extract field names
    const fieldMatches = fields.matchAll(/(\w+):\s*\{/g);
    const fieldNames = Array.from(fieldMatches, (m) => m[1]).filter(
      (f) => f !== 'type'
    );
    console.log(`  Fields: ${fieldNames.join(', ')}`);

    // Suggest VRM model
    const vrmSuggestion = suggestVrmModel(varName, fieldNames);
    console.log(`  ✨ Suggested VRM Model: ${vrmSuggestion.model}`);
    console.log(
      `  📝 Required Fields: ${vrmSuggestion.requiredFields.join(', ')}`
    );

    if (vrmSuggestion.additionalSetup) {
      console.log(`  ⚠️  Additional Setup: ${vrmSuggestion.additionalSetup}`);
    }
  });

  // Analyze relationships
  const relationships = content.matchAll(
    /(\w+)\.(belongsTo|hasMany|belongsToMany)\((\w+)/g
  );
  const rels = Array.from(relationships);

  if (rels.length > 0) {
    console.log('\n\n🔗 Relationships Found: ' + rels.length);
    console.log('─'.repeat(80));
    rels.forEach(([, model, type, target]) => {
      console.log(`  ${model} ${type} ${target}`);
      const vrmRel = suggestVrmRelationship(model, target, type);
      if (vrmRel) {
        console.log(`    ✨ VRM Equivalent: ${vrmRel}`);
      }
    });
  }

  // Analyze test count
  const tests = content.match(/test\('|it\('/g) || [];
  console.log(`\n\n📝 Total Tests: ${tests.length}`);

  // Estimate complexity
  const complexity = estimateComplexity(
    content,
    models.length,
    rels.length,
    tests.length
  );
  console.log(`\n⚙️  Conversion Complexity: ${complexity.level}`);
  console.log(`   Estimated Time: ${complexity.time}`);
  console.log(`   Manual Effort: ${complexity.effort}`);

  // Provide conversion checklist
  console.log('\n\n✅ Conversion Checklist:');
  console.log('─'.repeat(80));
  console.log(
    '  [ ] Run automated script: node scripts/convert-create-tests-to-vrm.js --file ' +
      filename
  );
  console.log('  [ ] Update field names to match VRM schema');
  console.log('  [ ] Add required fields (partNumber, email, vin, etc.)');
  console.log('  [ ] Update enum values to match VRM enums');

  if (rels.length > 0) {
    console.log('  [ ] Update relationship tests to use VRM relationships');
    console.log('  [ ] Create parent records before dependent records');
  }

  console.log('  [ ] Run tests: npm test -- ' + filename);
  console.log('  [ ] Fix any validation errors');
  console.log('  [ ] Verify all assertions still pass');

  console.log('\n' + '='.repeat(80) + '\n');
}

function suggestVrmModel(modelName, fields) {
  // Check for specific field patterns
  if (fields.includes('partNumber') || fields.includes('sku')) {
    return {
      model: 'Part',
      requiredFields: ['partNumber', 'name', 'category', 'unitPrice'],
    };
  }

  if (fields.includes('email') || fields.includes('firstName')) {
    return {
      model: 'Customer',
      requiredFields: ['firstName', 'lastName', 'email'],
    };
  }

  if (fields.includes('vin') || modelName.toLowerCase().includes('vehicle')) {
    return {
      model: 'Vehicle',
      requiredFields: ['vin', 'make', 'model', 'year'],
    };
  }

  if (fields.includes('vehicleId') || fields.includes('serviceType')) {
    return {
      model: 'ServiceRecord',
      requiredFields: [
        'vehicleId',
        'customerId',
        'serviceType',
        'description',
        'serviceDate',
      ],
      additionalSetup: 'Create Vehicle and Customer first',
    };
  }

  // Default suggestion
  return {
    model: 'Part',
    requiredFields: ['partNumber', 'name', 'category', 'unitPrice'],
  };
}

function suggestVrmRelationship(model, target, type) {
  const relationships = {
    'Customer-Vehicle':
      'Customer.belongsToMany(Vehicle, { through: CustomerVehicle })',
    'Vehicle-Customer':
      'Vehicle.belongsToMany(Customer, { through: CustomerVehicle })',
    'Vehicle-ServiceRecord':
      'Vehicle.hasMany(ServiceRecord, { foreignKey: "vehicle_id" })',
    'ServiceRecord-Vehicle':
      'ServiceRecord.belongsTo(Vehicle, { foreignKey: "vehicle_id" })',
    'Customer-ServiceRecord':
      'Customer.hasMany(ServiceRecord, { foreignKey: "customer_id" })',
    'ServiceRecord-Customer':
      'ServiceRecord.belongsTo(Customer, { foreignKey: "customer_id" })',
    'ServiceRecord-Part':
      'ServiceRecord.belongsToMany(Part, { through: ServicePart })',
    'Part-ServiceRecord':
      'Part.belongsToMany(ServiceRecord, { through: ServicePart })',
  };

  return (
    relationships[`${model}-${target}`] || relationships[`${target}-${model}`]
  );
}

function estimateComplexity(content, modelCount, relCount, testCount) {
  let score = 0;

  // Model complexity
  score += modelCount * 2;

  // Relationship complexity
  score += relCount * 3;

  // Test count
  score += testCount * 0.5;

  // Special patterns
  if (content.includes('bulkCreate')) score += 5;
  if (content.includes('transaction')) score += 3;
  if (content.includes('validate:')) score += 2;
  if (content.includes('relation_id_mapping')) score += 5;

  let level, time, effort;

  if (score < 20) {
    level = 'Simple';
    time = '10-20 minutes';
    effort = 'Low - mostly automated';
  } else if (score < 40) {
    level = 'Moderate';
    time = '20-40 minutes';
    effort = 'Medium - some manual adjustments needed';
  } else if (score < 60) {
    level = 'Complex';
    time = '40-60 minutes';
    effort = 'High - significant manual work required';
  } else {
    level = 'Very Complex';
    time = '1-2 hours';
    effort = 'Very High - careful manual conversion needed';
  }

  return { level, time, effort, score };
}

// Main
if (require.main === module) {
  const filename = process.argv[2];

  if (!filename) {
    console.error(
      '\n❌ Usage: node scripts/analyze-test-conversions.js <test-file>'
    );
    console.error(
      '   Example: node scripts/analyze-test-conversions.js create.bulk.test.js\n'
    );
    process.exit(1);
  }

  const testsDir = path.join(__dirname, '..', '__tests__');
  const filePath = path.join(testsDir, filename);

  if (!fs.existsSync(filePath)) {
    console.error(`\n❌ File not found: ${filePath}\n`);
    process.exit(1);
  }

  try {
    analyzeFile(filePath);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

module.exports = { analyzeFile, suggestVrmModel };
