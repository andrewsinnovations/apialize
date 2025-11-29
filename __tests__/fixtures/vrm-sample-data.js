/**
 * Sample data for VRM test database
 * Provides realistic customer, vehicle, parts, and service data for testing
 */

/**
 * Loads sample data into the VRM database models
 * @param {Object} models - Sequelize models object from createVrmDatabase
 * @returns {Promise<Object>} Created records organized by type
 */
async function loadSampleData(models) {
  const {
    Organization,
    User,
    Customer,
    Vehicle,
    CustomerVehicle,
    ServiceRecord,
    Part,
    ServicePart,
  } = models;

  // ==================== CREATE ORGANIZATIONS ====================
  const organizations = await Organization.bulkCreate([
    {
      name: 'Downtown Auto Dealership',
      slug: 'downtown-auto',
      description: 'Premium automotive sales and service in the heart of downtown',
      email: 'info@downtownauto.com',
      phoneNumber: '+1-555-1000',
      address: {
        street: '123 Main Street',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        country: 'USA',
      },
      settings: {
        timezone: 'America/Chicago',
        currency: 'USD',
        businessHours: {
          weekday: '8:00 AM - 6:00 PM',
          saturday: '9:00 AM - 4:00 PM',
          sunday: 'Closed',
        },
      },
      isActive: true,
    },
    {
      name: 'Elite Motors Group',
      slug: 'elite-motors',
      description: 'Luxury and performance vehicle specialists',
      email: 'contact@elitemotors.com',
      phoneNumber: '+1-555-2000',
      address: {
        street: '456 Luxury Lane',
        city: 'Beverly Hills',
        state: 'CA',
        zip: '90210',
        country: 'USA',
      },
      settings: {
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        businessHours: {
          weekday: '9:00 AM - 7:00 PM',
          saturday: '10:00 AM - 5:00 PM',
          sunday: '12:00 PM - 4:00 PM',
        },
      },
      isActive: true,
    },
    {
      name: 'Budget Car Center',
      slug: 'budget-car-center',
      description: 'Affordable vehicles and reliable service',
      email: 'service@budgetcarcenter.com',
      phoneNumber: '+1-555-3000',
      address: {
        street: '789 Economy Road',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'USA',
      },
      settings: {
        timezone: 'America/Chicago',
        currency: 'USD',
        businessHours: {
          weekday: '7:00 AM - 8:00 PM',
          saturday: '8:00 AM - 6:00 PM',
          sunday: '10:00 AM - 4:00 PM',
        },
      },
      isActive: true,
    },
  ]);

  // ==================== CREATE USERS ====================
  const users = await User.bulkCreate([
    {
      organizationId: organizations[0].id, // Downtown Auto
      username: 'jdoe',
      password: '$2b$10$abcdefghijklmnopqrstuvwxyz123456789', // Hashed password
      email: 'john.doe@downtownauto.com',
      isActive: true,
      lastLogin: '2025-11-27T14:30:00Z',
    },
    {
      organizationId: organizations[0].id, // Downtown Auto
      username: 'msmith',
      password: '$2b$10$abcdefghijklmnopqrstuvwxyz987654321',
      email: 'mary.smith@downtownauto.com',
      isActive: true,
      lastLogin: '2025-11-28T09:15:00Z',
    },
    {
      organizationId: organizations[1].id, // Elite Motors
      username: 'rwilson',
      password: '$2b$10$zyxwvutsrqponmlkjihgfedcba123456789',
      email: 'robert.wilson@elitemotors.com',
      isActive: true,
      lastLogin: '2025-11-28T10:00:00Z',
    },
    {
      organizationId: organizations[1].id, // Elite Motors
      username: 'lthompson',
      password: '$2b$10$zyxwvutsrqponmlkjihgfedcba987654321',
      email: 'linda.thompson@elitemotors.com',
      isActive: true,
      lastLogin: '2025-11-26T16:45:00Z',
    },
    {
      organizationId: organizations[2].id, // Budget Car Center
      username: 'tjones',
      password: '$2b$10$1234567890abcdefghijklmnopqrstuvwxyz',
      email: 'thomas.jones@budgetcarcenter.com',
      isActive: true,
      lastLogin: '2025-11-28T08:00:00Z',
    },
    {
      organizationId: organizations[2].id, // Budget Car Center
      username: 'sbrown',
      password: '$2b$10$9876543210zyxwvutsrqponmlkjihgfedcba',
      email: 'susan.brown@budgetcarcenter.com',
      isActive: false,
      lastLogin: '2025-11-20T12:30:00Z',
    },
  ]);

  // ==================== CREATE CUSTOMERS ====================
  const customers = await Customer.bulkCreate([
    {
      organizationId: organizations[0].id, // Downtown Auto
      firstName: 'John',
      lastName: 'Smith',
      email: 'john.smith@email.com',
      phoneNumber: '+1-555-0101',
      dateOfBirth: '1985-03-15',
      membershipTier: 'gold',
      accountBalance: 250.5,
      isActive: true,
      preferences: {
        notifications: { email: true, sms: false },
        preferredContactTime: 'morning',
      },
    },
    {
      organizationId: organizations[1].id, // Elite Motors
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah.johnson@email.com',
      phoneNumber: '+1-555-0102',
      dateOfBirth: '1990-07-22',
      membershipTier: 'platinum',
      accountBalance: 1500.75,
      isActive: true,
      preferences: {
        notifications: { email: true, sms: true },
        preferredContactTime: 'afternoon',
      },
    },
    {
      organizationId: organizations[1].id, // Elite Motors
      firstName: 'Michael',
      lastName: 'Chen',
      email: 'michael.chen@email.com',
      phoneNumber: '+1-555-0103',
      dateOfBirth: '1978-11-30',
      membershipTier: 'silver',
      accountBalance: -125.0,
      isActive: true,
      preferences: {
        notifications: { email: false, sms: true },
        language: 'en',
      },
    },
    {
      organizationId: organizations[2].id, // Budget Car Center
      firstName: 'Emily',
      lastName: 'Rodriguez',
      email: 'emily.rodriguez@email.com',
      phoneNumber: '+1-555-0104',
      dateOfBirth: '1995-02-14',
      membershipTier: 'bronze',
      accountBalance: 0.0,
      isActive: true,
      preferences: null,
    },
    {
      organizationId: organizations[0].id, // Downtown Auto
      firstName: 'David',
      lastName: 'Williams',
      email: 'david.williams@email.com',
      phoneNumber: '+1-555-0105',
      dateOfBirth: '1982-09-05',
      membershipTier: 'gold',
      accountBalance: 500.0,
      isActive: false,
      preferences: {
        notifications: { email: true, sms: true },
      },
    },
  ]);

  // ==================== CREATE VEHICLES ====================
  const vehicles = await Vehicle.bulkCreate([
    {
      vin: '1HGBH41JXMN109186',
      make: 'Honda',
      model: 'Accord',
      year: 2021,
      color: 'Silver',
      mileage: 15000,
      engineType: 'hybrid',
      purchasePrice: 28500.0,
      currentValue: 26000.0,
      licensePlate: 'ABC-1234',
      registrationExpiry: '2026-03-15',
      isActive: true,
      metadata: {
        trim: 'EX-L',
        transmission: 'CVT',
        doors: 4,
      },
    },
    {
      vin: '5YJSA1E14HF123456',
      make: 'Tesla',
      model: 'Model S',
      year: 2022,
      color: 'White',
      mileage: 8500,
      engineType: 'electric',
      purchasePrice: 89990.0,
      currentValue: 75000.0,
      licensePlate: 'TESLA-1',
      registrationExpiry: '2026-07-20',
      isActive: true,
      metadata: {
        batteryRange: 405,
        autopilot: true,
        trim: 'Long Range',
      },
    },
    {
      vin: '1FTFW1ET5EFC12345',
      make: 'Ford',
      model: 'F-150',
      year: 2020,
      color: 'Blue',
      mileage: 42000,
      engineType: 'gasoline',
      purchasePrice: 45000.0,
      currentValue: 38000.0,
      licensePlate: 'XYZ-9876',
      registrationExpiry: '2025-11-30',
      isActive: true,
      metadata: {
        trim: 'XLT',
        bedLength: '6.5ft',
        towing: 11000,
      },
    },
    {
      vin: 'WBAJA5C50HWB12345',
      make: 'BMW',
      model: '3 Series',
      year: 2023,
      color: 'Black',
      mileage: 5000,
      engineType: 'plugin-hybrid',
      purchasePrice: 52000.0,
      currentValue: 48000.0,
      licensePlate: 'BMW-330E',
      registrationExpiry: '2027-02-28',
      isActive: true,
      metadata: {
        trim: '330e',
        transmission: 'automatic',
        electricRange: 23,
      },
    },
    {
      vin: '1G1ZD5ST5HF123456',
      make: 'Chevrolet',
      model: 'Malibu',
      year: 2019,
      color: 'Red',
      mileage: 68000,
      engineType: 'gasoline',
      purchasePrice: 22000.0,
      currentValue: 15000.0,
      licensePlate: 'RED-CAR',
      registrationExpiry: '2025-06-15',
      isActive: true,
      metadata: null,
    },
    {
      vin: 'JM1BK32F781234567',
      make: 'Mazda',
      model: 'Mazda3',
      year: 2018,
      color: 'Gray',
      mileage: 78000,
      engineType: 'gasoline',
      purchasePrice: 18000.0,
      currentValue: 12000.0,
      licensePlate: null,
      registrationExpiry: null,
      isActive: false,
      metadata: {
        trim: 'Touring',
        previousOwners: 2,
      },
    },
  ]);

  // ==================== CREATE CUSTOMER-VEHICLE RELATIONSHIPS ====================
  const customerVehicles = await CustomerVehicle.bulkCreate([
    {
      customerId: customers[0].id, // John Smith
      vehicleId: vehicles[0].id, // Honda Accord
      relationship: 'owner',
      startDate: '2021-03-15',
      endDate: null,
      isPrimary: true,
      notes: 'Primary vehicle, purchased new',
    },
    {
      customerId: customers[1].id, // Sarah Johnson
      vehicleId: vehicles[1].id, // Tesla Model S
      relationship: 'owner',
      startDate: '2022-07-20',
      endDate: null,
      isPrimary: true,
      notes: null,
    },
    {
      customerId: customers[1].id, // Sarah Johnson
      vehicleId: vehicles[2].id, // Ford F-150
      relationship: 'owner',
      startDate: '2020-11-30',
      endDate: null,
      isPrimary: false,
      notes: 'Secondary vehicle for work',
    },
    {
      customerId: customers[2].id, // Michael Chen
      vehicleId: vehicles[3].id, // BMW 3 Series
      relationship: 'lessee',
      startDate: '2023-02-28',
      endDate: '2026-02-28',
      isPrimary: true,
      notes: '36-month lease',
    },
    {
      customerId: customers[3].id, // Emily Rodriguez
      vehicleId: vehicles[4].id, // Chevrolet Malibu
      relationship: 'owner',
      startDate: '2019-06-15',
      endDate: null,
      isPrimary: true,
      notes: 'Purchased used with 35k miles',
    },
    {
      customerId: customers[0].id, // John Smith
      vehicleId: vehicles[4].id, // Chevrolet Malibu
      relationship: 'authorized-driver',
      startDate: '2023-01-01',
      endDate: null,
      isPrimary: false,
      notes: 'Authorized to drive spouse vehicle',
    },
  ]);

  // ==================== CREATE PARTS ====================
  const parts = await Part.bulkCreate([
    {
      partNumber: 'BRK-PAD-001',
      name: 'Ceramic Brake Pad Set',
      description: 'High-performance ceramic brake pads for front axle',
      category: 'brakes',
      manufacturer: 'Brembo',
      unitPrice: 89.99,
      quantityInStock: 45,
      reorderLevel: 10,
      weight: 2.5,
      dimensions: { length: 15, width: 10, height: 5 },
      isActive: true,
      lastRestockDate: '2025-11-01',
    },
    {
      partNumber: 'OIL-FLT-002',
      name: 'Oil Filter',
      description: 'Standard oil filter for most vehicles',
      category: 'engine',
      manufacturer: 'Purolator',
      unitPrice: 12.99,
      quantityInStock: 200,
      reorderLevel: 50,
      weight: 0.3,
      dimensions: { length: 10, width: 10, height: 8 },
      isActive: true,
      lastRestockDate: '2025-10-15',
    },
    {
      partNumber: 'AIR-FLT-003',
      name: 'Engine Air Filter',
      description: 'High-flow engine air filter',
      category: 'engine',
      manufacturer: 'K&N',
      unitPrice: 45.5,
      quantityInStock: 75,
      reorderLevel: 20,
      weight: 0.5,
      dimensions: { length: 30, width: 20, height: 5 },
      isActive: true,
      lastRestockDate: '2025-11-10',
    },
    {
      partNumber: 'TIRE-AS-004',
      name: 'All-Season Tire 225/50R17',
      description: 'All-season touring tire',
      category: 'other',
      manufacturer: 'Michelin',
      unitPrice: 145.0,
      quantityInStock: 32,
      reorderLevel: 8,
      weight: 11.5,
      dimensions: { diameter: 66, width: 22.5 },
      isActive: true,
      lastRestockDate: '2025-09-20',
    },
    {
      partNumber: 'BAT-12V-005',
      name: '12V Car Battery',
      description: 'AGM battery 800 CCA',
      category: 'electrical',
      manufacturer: 'Optima',
      unitPrice: 225.0,
      quantityInStock: 18,
      reorderLevel: 5,
      weight: 18.5,
      dimensions: { length: 25, width: 17, height: 19 },
      isActive: true,
      lastRestockDate: '2025-11-15',
    },
    {
      partNumber: 'SUS-SHK-006',
      name: 'Front Shock Absorber',
      description: 'Gas-charged shock absorber for front suspension',
      category: 'suspension',
      manufacturer: 'Monroe',
      unitPrice: 78.5,
      quantityInStock: 24,
      reorderLevel: 8,
      weight: 3.2,
      dimensions: { length: 55, width: 8, height: 8 },
      isActive: true,
      lastRestockDate: '2025-10-01',
    },
    {
      partNumber: 'WIP-BLD-007',
      name: 'Wiper Blade Set',
      description: 'Premium beam-style wiper blades',
      category: 'other',
      manufacturer: 'Bosch',
      unitPrice: 34.99,
      quantityInStock: 60,
      reorderLevel: 15,
      weight: 0.4,
      dimensions: { length: 60, width: 5, height: 3 },
      isActive: true,
      lastRestockDate: '2025-11-05',
    },
    {
      partNumber: 'BRK-ROT-008',
      name: 'Brake Rotor (Front)',
      description: 'Vented brake rotor for front axle',
      category: 'brakes',
      manufacturer: 'Brembo',
      unitPrice: 125.0,
      quantityInStock: 16,
      reorderLevel: 6,
      weight: 8.5,
      dimensions: { diameter: 32, thickness: 2.8 },
      isActive: true,
      lastRestockDate: '2025-10-28',
    },
    {
      partNumber: 'CAB-FLT-009',
      name: 'Cabin Air Filter',
      description: 'HEPA cabin air filter with activated carbon',
      category: 'other',
      manufacturer: 'Mann Filter',
      unitPrice: 28.75,
      quantityInStock: 85,
      reorderLevel: 25,
      weight: 0.25,
      dimensions: { length: 25, width: 20, height: 3 },
      isActive: true,
      lastRestockDate: '2025-11-12',
    },
    {
      partNumber: 'SPK-PLG-010',
      name: 'Spark Plug Set (4)',
      description: 'Iridium spark plugs, set of 4',
      category: 'engine',
      manufacturer: 'NGK',
      unitPrice: 52.0,
      quantityInStock: 48,
      reorderLevel: 12,
      weight: 0.2,
      dimensions: { length: 8, width: 2, height: 2 },
      isActive: true,
      lastRestockDate: '2025-10-25',
    },
  ]);

  // ==================== CREATE SERVICE RECORDS ====================
  const serviceRecords = await ServiceRecord.bulkCreate([
    {
      vehicleId: vehicles[0].id, // Honda Accord
      customerId: customers[0].id, // John Smith
      serviceType: 'maintenance',
      description: 'Regular oil change and tire rotation',
      serviceDate: '2025-01-15',
      laborCost: 45.0,
      partsCost: 67.48,
      totalCost: 112.48,
      laborHours: 0.75,
      mileageAtService: 14500,
      technicianName: 'Mike Anderson',
      status: 'completed',
      warranty: false,
      notes: 'All fluids checked and topped off',
    },
    {
      vehicleId: vehicles[0].id, // Honda Accord
      customerId: customers[0].id, // John Smith
      serviceType: 'maintenance',
      description: 'Replace brake pads and rotors (front)',
      serviceDate: '2025-06-20',
      laborCost: 180.0,
      partsCost: 429.98,
      totalCost: 609.98,
      laborHours: 2.5,
      mileageAtService: 15000,
      technicianName: 'Mike Anderson',
      status: 'completed',
      warranty: true,
      notes: 'Brake fluid flushed, new pads and rotors installed',
    },
    {
      vehicleId: vehicles[1].id, // Tesla Model S
      customerId: customers[1].id, // Sarah Johnson
      serviceType: 'inspection',
      description: 'Annual safety inspection',
      serviceDate: '2025-07-25',
      laborCost: 75.0,
      partsCost: 0.0,
      totalCost: 75.0,
      laborHours: 1.0,
      mileageAtService: 8200,
      technicianName: 'Jennifer Lee',
      status: 'completed',
      warranty: false,
      notes: 'All systems passed inspection',
    },
    {
      vehicleId: vehicles[2].id, // Ford F-150
      customerId: customers[1].id, // Sarah Johnson
      serviceType: 'repair',
      description: 'Replace battery and check charging system',
      serviceDate: '2025-03-10',
      laborCost: 95.0,
      partsCost: 225.0,
      totalCost: 320.0,
      laborHours: 1.25,
      mileageAtService: 41500,
      technicianName: 'Carlos Martinez',
      status: 'completed',
      warranty: true,
      notes: 'Old battery tested at 8.5V, replaced with new AGM battery',
    },
    {
      vehicleId: vehicles[3].id, // BMW 3 Series
      customerId: customers[2].id, // Michael Chen
      serviceType: 'maintenance',
      description: 'Scheduled 5,000 mile service',
      serviceDate: '2025-11-20',
      laborCost: 120.0,
      partsCost: 86.49,
      totalCost: 206.49,
      laborHours: 1.5,
      mileageAtService: 5000,
      technicianName: 'Jennifer Lee',
      status: 'completed',
      warranty: false,
      notes: 'Oil change, air filter, cabin filter replaced',
    },
    {
      vehicleId: vehicles[4].id, // Chevrolet Malibu
      customerId: customers[3].id, // Emily Rodriguez
      serviceType: 'maintenance',
      description: 'Replace tires (all four)',
      serviceDate: '2025-09-05',
      laborCost: 80.0,
      partsCost: 580.0,
      totalCost: 660.0,
      laborHours: 1.0,
      mileageAtService: 67500,
      technicianName: 'Mike Anderson',
      status: 'completed',
      warranty: true,
      notes: 'All four tires replaced, aligned and balanced',
    },
    {
      vehicleId: vehicles[4].id, // Chevrolet Malibu
      customerId: customers[3].id, // Emily Rodriguez
      serviceType: 'repair',
      description: 'Front suspension repair',
      serviceDate: '2025-11-28',
      laborCost: 350.0,
      partsCost: 157.0,
      totalCost: 507.0,
      laborHours: 4.5,
      mileageAtService: 68000,
      technicianName: 'Carlos Martinez',
      status: 'in-progress',
      warranty: false,
      notes: 'Replacing both front shock absorbers',
    },
    {
      vehicleId: vehicles[1].id, // Tesla Model S
      customerId: customers[1].id, // Sarah Johnson
      serviceType: 'recall',
      description: 'Software update - recall campaign',
      serviceDate: '2025-12-01',
      laborCost: 0.0,
      partsCost: 0.0,
      totalCost: 0.0,
      laborHours: 0.5,
      mileageAtService: 8500,
      technicianName: 'Jennifer Lee',
      status: 'scheduled',
      warranty: true,
      notes: 'Recall for infotainment system update',
    },
  ]);

  // ==================== CREATE SERVICE-PARTS RELATIONSHIPS ====================
  const serviceParts = await ServicePart.bulkCreate([
    {
      serviceRecordId: serviceRecords[0].id, // Oil change
      partId: parts[1].id, // Oil Filter
      quantity: 1,
      unitPrice: 12.99,
      totalPrice: 12.99,
      warranty: false,
      warrantyMonths: null,
    },
    {
      serviceRecordId: serviceRecords[0].id, // Oil change
      partId: parts[6].id, // Wiper Blade Set
      quantity: 1,
      unitPrice: 34.99,
      totalPrice: 34.99,
      warranty: false,
      warrantyMonths: null,
    },
    {
      serviceRecordId: serviceRecords[1].id, // Brake job
      partId: parts[0].id, // Brake Pads
      quantity: 1,
      unitPrice: 89.99,
      totalPrice: 89.99,
      warranty: true,
      warrantyMonths: 24,
    },
    {
      serviceRecordId: serviceRecords[1].id, // Brake job
      partId: parts[7].id, // Brake Rotors
      quantity: 2,
      unitPrice: 125.0,
      totalPrice: 250.0,
      warranty: true,
      warrantyMonths: 24,
    },
    {
      serviceRecordId: serviceRecords[3].id, // Battery replacement
      partId: parts[4].id, // Battery
      quantity: 1,
      unitPrice: 225.0,
      totalPrice: 225.0,
      warranty: true,
      warrantyMonths: 36,
    },
    {
      serviceRecordId: serviceRecords[4].id, // BMW 5k service
      partId: parts[1].id, // Oil Filter
      quantity: 1,
      unitPrice: 12.99,
      totalPrice: 12.99,
      warranty: false,
      warrantyMonths: null,
    },
    {
      serviceRecordId: serviceRecords[4].id, // BMW 5k service
      partId: parts[2].id, // Air Filter
      quantity: 1,
      unitPrice: 45.5,
      totalPrice: 45.5,
      warranty: false,
      warrantyMonths: null,
    },
    {
      serviceRecordId: serviceRecords[4].id, // BMW 5k service
      partId: parts[8].id, // Cabin Filter
      quantity: 1,
      unitPrice: 28.75,
      totalPrice: 28.75,
      warranty: false,
      warrantyMonths: null,
    },
    {
      serviceRecordId: serviceRecords[5].id, // Tire replacement
      partId: parts[3].id, // Tires
      quantity: 4,
      unitPrice: 145.0,
      totalPrice: 580.0,
      warranty: true,
      warrantyMonths: 60,
    },
    {
      serviceRecordId: serviceRecords[6].id, // Suspension repair
      partId: parts[5].id, // Shock Absorbers
      quantity: 2,
      unitPrice: 78.5,
      totalPrice: 157.0,
      warranty: true,
      warrantyMonths: 12,
    },
  ]);

  return {
    organizations,
    users,
    customers,
    vehicles,
    customerVehicles,
    serviceRecords,
    parts,
    serviceParts,
  };
}

/**
 * Clears all data from the VRM database tables
 * @param {Object} models - Sequelize models object from createVrmDatabase
 */
async function clearSampleData(models) {
  const {
    Organization,
    User,
    Customer,
    Vehicle,
    CustomerVehicle,
    ServiceRecord,
    Part,
    ServicePart,
  } = models;

  // Delete in order to respect foreign key constraints
  // Use force: true to permanently delete records (not just soft delete with paranoid)
  await ServicePart.destroy({ where: {}, force: true });
  await ServiceRecord.destroy({ where: {}, force: true });
  await CustomerVehicle.destroy({ where: {}, force: true });
  await Part.destroy({ where: {}, force: true });
  await Vehicle.destroy({ where: {}, force: true });
  await Customer.destroy({ where: {}, force: true });
  await User.destroy({ where: {}, force: true });
  await Organization.destroy({ where: {}, force: true });
}

module.exports = {
  loadSampleData,
  clearSampleData,
};
