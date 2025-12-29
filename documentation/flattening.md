# Response Flattening

Response flattening allows you to lift attributes from related models directly onto the parent record in API responses. This simplifies response structures by eliminating nested objects while still leveraging Sequelize's powerful association system.

## Quick Reference

| Option | Type | Description |
|--------|------|-------------|
| [`model`](#model) | `Model` | The Sequelize model to flatten (required) |
| [`as`](#as) | `string` | The association alias (required) |
| [`attributes`](#attributes) | `Array` | Fields to flatten, with optional aliasing (required) |
| [`where`](#where) | `Object` | Filter conditions for the included model |
| [`required`](#required) | `boolean` | Whether to use inner join (default: `true`) |
| [`through`](#through) | `Object` | Options for through tables in many-to-many relations |
| [`on`](#on) | `Object` | Custom join conditions |

## Supported Operations

Flattening is available on the following operations:

| Operation | Support |
|-----------|---------|
| [list](list.md) | ✓ |
| [search](search.md) | ✓ |
| [single](single.md) | ✓ |

## Basic Usage

### Without Flattening

By default, related model data appears nested:

```javascript
app.use('/persons', list(Person, {}, {
  include: [{ model: PersonNames, as: 'Names' }]
}));
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "login": "john.doe@example.com",
      "Names": {
        "first_name": "John",
        "last_name": "Doe",
        "age": 30
      }
    }
  ]
}
```

### With Flattening

Flattening lifts attributes to the parent level:

```javascript
app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', 'last_name']
  }
}));
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "login": "john.doe@example.com",
      "first_name": "John",
      "last_name": "Doe"
    }
  ]
}
```

Note: The nested `Names` object is automatically removed after flattening.

## Configuration Options

### model

**Type:** `Model` (required)

The Sequelize model whose attributes should be flattened.

```javascript
flattening: {
  model: PersonNames,  // The related Sequelize model
  as: 'Names',
  attributes: ['first_name']
}
```

### as

**Type:** `string` (required)

The association alias as defined in your Sequelize model associations.

```javascript
// Model association
Person.hasOne(PersonNames, { foreignKey: 'person_id', as: 'Names' });

// Flattening config must match the alias
flattening: {
  model: PersonNames,
  as: 'Names',  // Must match the association alias
  attributes: ['first_name']
}
```

### attributes

**Type:** `Array<string | [string, string]>` (required)

Specifies which fields to flatten. Supports two formats:

**Simple string** - Uses the original field name:
```javascript
attributes: ['first_name', 'last_name', 'age']
```

**Array with alias** - `[originalName, aliasName]`:
```javascript
attributes: [
  'first_name',                    // Keeps original name
  ['last_name', 'surname'],        // Renames to 'surname'
  ['age', 'person_age']            // Renames to 'person_age'
]
```

**Example:**
```javascript
app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: [
      'first_name',
      ['last_name', 'surname'],
      ['age', 'person_age']
    ]
  }
}));
```

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "login": "john.doe@example.com",
      "first_name": "John",
      "surname": "Doe",
      "person_age": 30
    }
  ]
}
```

### where

**Type:** `Object`

Filter conditions applied to the included model.

```javascript
app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', 'last_name'],
    where: { is_active: true }  // Only include active names
  }
}));
```

### required

**Type:** `boolean`  
**Default:** `true`

Controls whether to use an inner join (`true`) or left join (`false`).

```javascript
// Inner join (default) - excludes records without matching related data
app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name'],
    required: true
  }
}));

// Left join - includes records even without matching related data
app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name'],
    required: false  // Person without Names will have null for first_name
  }
}));
```

### through

**Type:** `Object`

Options for many-to-many relationships using a through table.

```javascript
// Many-to-many: Student belongsToMany Course through Enrollment
app.use('/students', list(Student, {
  flattening: {
    model: Course,
    as: 'Courses',
    attributes: ['course_code', 'title'],
    through: {
      where: { status: 'completed' },  // Only completed enrollments
      attributes: ['grade', 'semester']  // Include through table fields
    }
  }
}));
```

### on

**Type:** `Object`

Custom join conditions using Sequelize operators.

```javascript
const { Op } = require('sequelize');

app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', 'last_name'],
    on: {
      person_id: { [Op.col]: 'Person.id' },
      is_active: true
    }
  }
}));
```

## Auto-Include Creation

When you specify a flattening configuration, the include is automatically created if not explicitly provided:

```javascript
// This works without specifying the include in modelOptions
app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', 'last_name']
  }
}));
// The include for PersonNames is automatically added
```

You can also provide explicit includes for more control:

```javascript
app.use('/persons', list(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', 'last_name']
  }
}, {
  include: [{ 
    model: PersonNames, 
    as: 'Names', 
    required: true,
    attributes: ['first_name', 'last_name', 'age']  // Include more for internal use
  }]
}));
```

## Multiple Flattenings

You can flatten multiple associations by passing an array:

```javascript
app.use('/persons', list(Person, {
  flattening: [
    {
      model: PersonNames,
      as: 'Names',
      attributes: ['first_name', 'last_name']
    },
    {
      model: Address,
      as: 'Addresses',
      attributes: ['city', 'country']
    },
    {
      model: ContactInfo,
      as: 'Contact',
      attributes: [['email', 'email_address'], 'phone']
    }
  ]
}));
```

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "login": "john.doe@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "city": "New York",
      "country": "USA",
      "email_address": "john@example.com",
      "phone": "555-0001"
    }
  ]
}
```

## Filtering on Flattened Fields

Flattened fields can be filtered just like regular fields:

### Simple Equality

```http
GET /persons?first_name=John
```

### Using Filter Operators

```http
GET /persons?first_name:icontains=jo
GET /persons?age:gte=30
GET /persons?surname:in=Doe,Smith
```

### Combining with Regular Fields

```http
GET /persons?first_name=John&login=john.doe@example.com
```

See [Filtering](filtering.md) for the full list of filter operators.

## Ordering on Flattened Fields

Flattened fields can be used for sorting:

```http
GET /persons?api:order_by=last_name
GET /persons?api:order_by=-surname
GET /persons?api:order_by=age,first_name
```

## Search Operation

Flattening works identically in the search operation:

```javascript
app.use('/persons', search(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', ['last_name', 'surname']]
  }
}));
```

**Request:**
```http
POST /persons/search
Content-Type: application/json

{
  "filtering": {
    "first_name": "John"
  }
}
```

## Single Operation

Flattening also works for single record retrieval:

```javascript
app.use('/persons', single(Person, {
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', 'last_name']
  }
}));
```

**Response:**
```json
{
  "success": true,
  "record": {
    "id": 1,
    "login": "john.doe@example.com",
    "first_name": "John",
    "last_name": "Doe"
  }
}
```

## Working with ID Mapping

Flattening works seamlessly with `id_mapping`:

```javascript
app.use('/persons', list(Person, {
  id_mapping: 'external_id',
  flattening: {
    model: PersonNames,
    as: 'Names',
    attributes: ['first_name', ['last_name', 'surname']]
  }
}));
```

**Response:**
```json
{
  "data": [
    {
      "id": "person-123",
      "login": "john.doe@example.com",
      "first_name": "John",
      "surname": "Doe"
    }
  ]
}
```

## Many-to-Many Relationships

Flattening supports `belongsToMany` relationships with through tables:

```javascript
// Models
Student.belongsToMany(Course, {
  through: Enrollment,
  foreignKey: 'student_id',
  otherKey: 'course_id',
  as: 'Courses'
});

// Flattening with through table options
app.use('/students', list(Student, {
  flattening: {
    model: Course,
    as: 'Courses',
    attributes: ['course_code', ['title', 'course_title']],
    through: {
      where: { status: 'completed' },
      attributes: ['grade', 'semester']
    }
  }
}));
```

**Note:** With many-to-many relationships, a student enrolled in multiple courses will produce multiple rows in the response (one per course).

## Best Practices

### 1. Use Aliases to Avoid Collisions

When flattening fields that might collide with parent model fields, use aliases:

```javascript
flattening: {
  model: PersonNames,
  as: 'Names',
  attributes: [
    ['id', 'name_id'],        // Avoid collision with Person.id
    ['name', 'person_name']   // Avoid collision with any parent 'name' field
  ]
}
```

### 2. Be Selective with Attributes

Only flatten the attributes you need to keep responses clean:

```javascript
// Good - only necessary fields
flattening: {
  model: PersonNames,
  as: 'Names',
  attributes: ['first_name', 'last_name']
}

// Avoid - flattening everything
flattening: {
  model: PersonNames,
  as: 'Names',
  attributes: ['id', 'person_id', 'first_name', 'last_name', 'age', 'is_preferred', 'created_at', 'updated_at']
}
```

### 3. Consider Required vs Optional Joins

Use `required: false` when the related data might not exist:

```javascript
flattening: {
  model: PersonNames,
  as: 'Names',
  attributes: ['first_name'],
  required: false  // Don't exclude persons without names
}
```

### 4. Use Multiple Flattenings Judiciously

While you can flatten multiple associations, be mindful of response size and query complexity:

```javascript
// Reasonable - related data that logically belongs together
flattening: [
  { model: PersonNames, as: 'Names', attributes: ['first_name', 'last_name'] },
  { model: ContactInfo, as: 'Contact', attributes: ['email', 'phone'] }
]
```

## Common Use Cases

### Simplifying User Profiles

```javascript
// Instead of nested profile data
app.use('/users', list(User, {
  flattening: {
    model: UserProfile,
    as: 'Profile',
    attributes: ['bio', 'avatar_url', 'location']
  }
}));
```

### Displaying Product Information with Category

```javascript
app.use('/products', list(Product, {
  flattening: {
    model: Category,
    as: 'Category',
    attributes: [['name', 'category_name']]
  }
}));
```

### Orders with Customer Details

```javascript
app.use('/orders', list(Order, {
  flattening: [
    {
      model: Customer,
      as: 'Customer',
      attributes: [['name', 'customer_name'], ['email', 'customer_email']]
    },
    {
      model: ShippingAddress,
      as: 'ShippingAddress',
      attributes: ['city', 'country']
    }
  ]
}));
```

## Related Documentation

- [list](list.md) - List operation
- [search](search.md) - Search operation
- [single](single.md) - Single operation
- [Filtering](filtering.md) - Filter operators for flattened fields
