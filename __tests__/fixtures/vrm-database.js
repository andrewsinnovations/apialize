const { Sequelize, DataTypes } = require('sequelize');
const { loadSampleData } = require('./vrm-sample-data');

/**
 * Creates and configures a complete VRM (Vehicle Relationship Management) database
 * with realistic tables, relationships, and varying data types for testing.
 * 
 * Includes:
 * - Organizations table
 * - Users table with username/password
 * - Customers table with UUIDs
 * - Vehicles table with external UUIDs
 * - Service records with timestamps and decimals
 * - Parts inventory with various datatypes
 * - Many-to-many relationships (CustomerVehicles, ServiceParts)
 * - One-to-many relationships
 * 
 * @param {Object} options - Configuration options
 * @param {boolean} options.logging - Enable SQL logging (default: false)
 * @param {boolean} options.loadData - Automatically load sample data (default: true)
 * @returns {Promise<Object>} Database instance with sequelize and models
 */
async function createVrmDatabase(options = {}) {
  const { logging = false, loadData = true } = options;
  
  const sequelize = new Sequelize('sqlite::memory:', { 
    logging 
  });

  // ==================== ORGANIZATIONS TABLE ====================
  const Organization = sequelize.define(
    'Organization',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
          is: /^[a-z0-9-]+$/,
        },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },
      phoneNumber: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'phone_number',
      },
      address: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      settings: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'is_active',
      },
    },
    { 
      tableName: 'organizations',
      timestamps: true,
      underscored: true,
      paranoid: true,
    }
  );

  // ==================== CUSTOMERS TABLE ====================
  const Customer = sequelize.define(
    'Customer',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'organizations',
          key: 'id',
        },
        field: 'organization_id',
      },
      externalId: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
        allowNull: false,
        field: 'external_id',
      },
      firstName: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'first_name',
      },
      lastName: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'last_name',
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      phoneNumber: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'phone_number',
      },
      dateOfBirth: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'date_of_birth',
      },
      membershipTier: {
        type: DataTypes.ENUM('bronze', 'silver', 'gold', 'platinum'),
        defaultValue: 'bronze',
        field: 'membership_tier',
      },
      accountBalance: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        field: 'account_balance',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'is_active',
      },
      preferences: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    { 
      tableName: 'customers',
      timestamps: true,
      underscored: true,
      paranoid: true,
    }
  );

  // ==================== USERS TABLE ====================
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'organizations',
          key: 'id',
        },
        field: 'organization_id',
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        validate: {
          len: [3, 50],
        },
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          len: [6, 255],
        },
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'is_active',
      },
      lastLogin: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_login',
      },
    },
    { 
      tableName: 'users',
      timestamps: true,
      underscored: true,
      paranoid: true,
    }
  );

  // ==================== VEHICLES TABLE ====================
  const Vehicle = sequelize.define(
    'Vehicle',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      externalId: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
        allowNull: false,
        field: 'external_id',
      },
      vin: {
        type: DataTypes.STRING(17),
        allowNull: false,
        unique: true,
        validate: {
          len: [17, 17],
        },
      },
      make: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      model: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1900,
          max: 2100,
        },
      },
      color: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      mileage: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      engineType: {
        type: DataTypes.ENUM('gasoline', 'diesel', 'electric', 'hybrid', 'plugin-hybrid'),
        allowNull: true,
        field: 'engine_type',
      },
      purchasePrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        field: 'purchase_price',
      },
      currentValue: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        field: 'current_value',
      },
      licensePlate: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'license_plate',
      },
      registrationExpiry: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'registration_expiry',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'is_active',
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    { 
      tableName: 'vehicles',
      timestamps: true,
      underscored: true,
      paranoid: true,
    }
  );

  // ==================== CUSTOMER-VEHICLE (Many-to-Many) ====================
  const CustomerVehicle = sequelize.define(
    'CustomerVehicle',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      customerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'customers',
          key: 'id',
        },
        field: 'customer_id',
      },
      vehicleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'vehicles',
          key: 'id',
        },
        field: 'vehicle_id',
      },
      relationship: {
        type: DataTypes.ENUM('owner', 'co-owner', 'authorized-driver', 'lessee'),
        defaultValue: 'owner',
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'start_date',
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'end_date',
      },
      isPrimary: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: 'is_primary',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    { 
      tableName: 'customer_vehicles',
      timestamps: true,
      underscored: true,
      paranoid: true,
      indexes: [
        {
          unique: true,
          fields: ['customer_id', 'vehicle_id'],
        },
      ],
    }
  );

  // ==================== SERVICE RECORDS TABLE ====================
  const ServiceRecord = sequelize.define(
    'ServiceRecord',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      externalId: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
        allowNull: false,
        field: 'external_id',
      },
      vehicleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'vehicles',
          key: 'id',
        },
        field: 'vehicle_id',
      },
      customerId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'customers',
          key: 'id',
        },
        field: 'customer_id',
      },
      serviceType: {
        type: DataTypes.ENUM('maintenance', 'repair', 'inspection', 'warranty', 'recall'),
        allowNull: false,
        field: 'service_type',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      serviceDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'service_date',
      },
      laborCost: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        field: 'labor_cost',
      },
      partsCost: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        field: 'parts_cost',
      },
      totalCost: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        field: 'total_cost',
      },
      laborHours: {
        type: DataTypes.DECIMAL(5, 2),
        defaultValue: 0.00,
        field: 'labor_hours',
      },
      mileageAtService: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'mileage_at_service',
      },
      technicianName: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'technician_name',
      },
      status: {
        type: DataTypes.ENUM('scheduled', 'in-progress', 'completed', 'cancelled'),
        defaultValue: 'scheduled',
      },
      warranty: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    { 
      tableName: 'service_records',
      timestamps: true,
      underscored: true,
      paranoid: true,
    }
  );

  // ==================== PARTS TABLE ====================
  const Part = sequelize.define(
    'Part',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      externalId: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
        allowNull: false,
        field: 'external_id',
      },
      partNumber: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        field: 'part_number',
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      category: {
        type: DataTypes.ENUM('engine', 'transmission', 'brakes', 'suspension', 'electrical', 'body', 'interior', 'other'),
        allowNull: false,
      },
      manufacturer: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      unitPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'unit_price',
      },
      quantityInStock: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        field: 'quantity_in_stock',
        validate: {
          min: 0,
        },
      },
      reorderLevel: {
        type: DataTypes.INTEGER,
        defaultValue: 5,
        field: 'reorder_level',
      },
      weight: {
        type: DataTypes.DECIMAL(8, 3),
        allowNull: true,
        comment: 'Weight in kilograms',
      },
      dimensions: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'JSON object with length, width, height',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'is_active',
      },
      lastRestockDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'last_restock_date',
      },
    },
    { 
      tableName: 'parts',
      timestamps: true,
      underscored: true,
      paranoid: true,
    }
  );

  // ==================== SERVICE-PARTS (Many-to-Many) ====================
  const ServicePart = sequelize.define(
    'ServicePart',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      serviceRecordId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'service_records',
          key: 'id',
        },
        field: 'service_record_id',
      },
      partId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'parts',
          key: 'id',
        },
        field: 'part_id',
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
          min: 1,
        },
      },
      unitPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'unit_price',
      },
      totalPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'total_price',
      },
      warranty: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      warrantyMonths: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'warranty_months',
      },
    },
    { 
      tableName: 'service_parts',
      timestamps: true,
      underscored: true,
      paranoid: true,
    }
  );

  // ==================== DEFINE RELATIONSHIPS ====================
  
  // Organization -> Users (One-to-Many)
  Organization.hasMany(User, {
    foreignKey: 'organization_id',
    as: 'users',
  });

  User.belongsTo(Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });

  // Organization -> Customers (One-to-Many)
  Organization.hasMany(Customer, {
    foreignKey: 'organization_id',
    as: 'customers',
  });

  Customer.belongsTo(Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });

  // Customer <-> Vehicle (Many-to-Many through CustomerVehicle)
  Customer.belongsToMany(Vehicle, {
    through: CustomerVehicle,
    foreignKey: 'customer_id',
    otherKey: 'vehicle_id',
    as: 'vehicles',
  });

  Vehicle.belongsToMany(Customer, {
    through: CustomerVehicle,
    foreignKey: 'vehicle_id',
    otherKey: 'customer_id',
    as: 'customers',
  });

  // Direct access to junction table
  Customer.hasMany(CustomerVehicle, {
    foreignKey: 'customer_id',
    as: 'customerVehicles',
  });

  Vehicle.hasMany(CustomerVehicle, {
    foreignKey: 'vehicle_id',
    as: 'customerVehicles',
  });

  CustomerVehicle.belongsTo(Customer, {
    foreignKey: 'customer_id',
    as: 'customer',
  });

  CustomerVehicle.belongsTo(Vehicle, {
    foreignKey: 'vehicle_id',
    as: 'vehicle',
  });

  // Vehicle -> ServiceRecords (One-to-Many)
  Vehicle.hasMany(ServiceRecord, {
    foreignKey: 'vehicle_id',
    as: 'serviceRecords',
  });

  ServiceRecord.belongsTo(Vehicle, {
    foreignKey: 'vehicle_id',
    as: 'vehicle',
  });

  // Customer -> ServiceRecords (One-to-Many)
  Customer.hasMany(ServiceRecord, {
    foreignKey: 'customer_id',
    as: 'serviceRecords',
  });

  ServiceRecord.belongsTo(Customer, {
    foreignKey: 'customer_id',
    as: 'customer',
  });

  // ServiceRecord <-> Part (Many-to-Many through ServicePart)
  ServiceRecord.belongsToMany(Part, {
    through: ServicePart,
    foreignKey: 'service_record_id',
    otherKey: 'part_id',
    as: 'parts',
  });

  Part.belongsToMany(ServiceRecord, {
    through: ServicePart,
    foreignKey: 'part_id',
    otherKey: 'service_record_id',
    as: 'serviceRecords',
  });

  // Direct access to junction table
  ServiceRecord.hasMany(ServicePart, {
    foreignKey: 'service_record_id',
    as: 'serviceParts',
  });

  Part.hasMany(ServicePart, {
    foreignKey: 'part_id',
    as: 'serviceParts',
  });

  ServicePart.belongsTo(ServiceRecord, {
    foreignKey: 'service_record_id',
    as: 'serviceRecord',
  });

  ServicePart.belongsTo(Part, {
    foreignKey: 'part_id',
    as: 'part',
  });

  const models = {
    Organization,
    User,
    Customer,
    Vehicle,
    CustomerVehicle,
    ServiceRecord,
    Part,
    ServicePart,
  };

  // Sync database schema
  await sequelize.sync({ force: true });

  // Optionally load sample data
  let sampleData = null;
  if (loadData) {
    sampleData = await loadSampleData(models);
  }

  return {
    sequelize,
    models,
    sampleData,
  };
}

module.exports = { createVrmDatabase };
