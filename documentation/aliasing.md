# Field Aliasing

Field aliasing allows you to map external API field names to internal database column names. This is useful when you want to expose a cleaner, more user-friendly API while maintaining your existing database schema.

## Table of Contents

- [Overview](#overview)
- [Basic Usage](#basic-usage)
- [How It Works](#how-it-works)
- [Supported Operations](#supported-operations)
- [Configuration](#configuration)
- [Use Cases](#use-cases)
- [Integration with Other Features](#integration-with-other-features)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Overview

The `aliases` option provides a mapping between external field names (used by API clients) and internal database column names. This allows you to:

- Present a clean, consistent API regardless of database naming conventions
- Rename fields without changing your database schema
- Hide implementation details from API consumers
- Maintain backward compatibility when refactoring

## Basic Usage

```javascript
const { list, create, patch, single } = require('apialize');

// Database column: person_name → API field: name
const aliases = {
  name: 'person_name',
  age: 'person_age',
  email: 'person_email'
};

app.use('/persons', list(Person, { aliases }));
app.use('/persons', single(Person, { aliases }));
app.use('/persons', create(Person, { aliases }));
app.use('/persons', patch(Person, { aliases }));
```

## How It Works

The alias configuration is an object where:
- **Keys** are the external field names (what API clients see)
- **Values** are the internal database column names

```javascript
const aliases = {
  // External name: Internal column name
  'name': 'person_name',
  'category': 'item_category'
};
```

### Request Transformation (Input)

When a client sends data using external names, apialize automatically transforms it to internal names before database operations:

```javascript
// Client sends:
{ "name": "John Doe", "age": 30 }

// Transformed to (with aliases: { name: 'person_name', age: 'person_age' }):
{ "person_name": "John Doe", "person_age": 30 }
```

### Response Transformation (Output)

When returning data to clients, internal names are transformed back to external names:

```javascript
// Database returns:
{ "person_name": "John Doe", "person_age": 30 }

// Transformed to (in API response):
{ "name": "John Doe", "age": 30 }
```

### Query Parameter Transformation

For list and search operations, query parameters and filters use external names:

```
GET /persons?name=John Doe

// Translates to: WHERE person_name = 'John Doe'
```

## Supported Operations

Field aliases are supported across all apialize operations:

| Operation | Input Mapping | Output Mapping | Filter/Query Mapping |
|-----------|---------------|----------------|----------------------|
| [list](list.md) | N/A | ✓ | ✓ |
| [search](search.md) | N/A | ✓ | ✓ |
| [single](single.md) | N/A | ✓ | N/A |
| [create](create.md) | ✓ | N/A | N/A |
| [update](update.md) | ✓ | N/A | N/A |
| [patch](patch.md) | ✓ | N/A | N/A |

## Configuration

### `aliases`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Map of external field names to internal database column names.

```javascript
app.use('/items', list(Item, {
  aliases: {
    'name': 'item_name',
    'category': 'item_category',
    'price': 'unit_price'
  }
}));
```

## Use Cases

### 1. Cleaner API Names

Convert database naming conventions (like snake_case with prefixes) to clean camelCase or simple names:

```javascript
// Database columns: user_first_name, user_last_name, user_email_address
const aliases = {
  firstName: 'user_first_name',
  lastName: 'user_last_name',
  email: 'user_email_address'
};

app.use('/users', list(User, { aliases }));
```

**API Request:**
```
GET /users?firstName=John
```

**API Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com"
    }
  ]
}
```

### 2. Hiding Implementation Details

Expose logical names without revealing database structure:

```javascript
const aliases = {
  status: 'internal_status_code',
  createdAt: 'record_creation_timestamp'
};
```

### 3. Backward Compatibility

When renaming columns, maintain the old API field names:

```javascript
// Column renamed from 'title' to 'person_name' in database
// Keep API using 'title' for backward compatibility
const aliases = {
  title: 'person_name'
};
```

### 4. ID Field Aliasing

You can alias the ID field to expose a different primary key:

```javascript
const aliases = {
  personId: 'id'
};

app.use('/persons', list(Person, { 
  aliases,
  id_mapping: 'id',
  default_order_by: 'personId'  // Use the aliased name
}));
```

## Integration with Other Features

### With Filtering Options

When using `allow_filtering_on`, `block_filtering_on`, or similar field restriction options, use the **external alias names**:

```javascript
const aliases = {
  name: 'person_name',
  age: 'person_age',
  email: 'person_email'
};

app.use('/persons', list(Person, {
  aliases,
  allow_filtering_on: ['name', 'age'],  // Use external names
  block_filtering_on: ['email']          // Use external names
}));
```

### With Ordering Options

Similarly, `allow_ordering_on`, `block_ordering_on`, and `default_order_by` use external names:

```javascript
app.use('/persons', list(Person, {
  aliases,
  allow_ordering_on: ['name', 'age'],  // Use external names
  default_order_by: 'name'              // Use external name
}));
```

### With Field Control Options

`allowed_fields` and `blocked_fields` in create, update, and patch operations use external names:

```javascript
app.use('/persons', create(Person, {
  aliases: {
    name: 'person_name',
    age: 'person_age',
    email: 'person_email'
  },
  allowed_fields: ['name', 'age'],  // Use external names
  blocked_fields: ['email']          // Use external names
}));
```

### With Flattening

Field aliases work alongside flattening without interference. Each feature handles its own transformation:

```javascript
const aliases = {
  name: 'person_name'
};

const flattening = {
  model: Address,
  as: 'Address',
  attributes: [['city', 'address_city']]
};

app.use('/persons', list(Person, {
  aliases,
  flattening
}));
```

Response includes both aliased fields and flattened fields:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "John Doe",
      "address_city": "New York"
    }
  ]
}
```

## Examples

### List Operation

```javascript
app.use('/persons', list(Person, {
  aliases: {
    name: 'person_name',
    age: 'person_age'
  }
}));

// GET /persons?name=John&age:gte=25&api:order_by=age
```

Response:
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "John Doe", "age": 30 },
    { "id": 2, "name": "John Smith", "age": 35 }
  ],
  "meta": { "paging": { "count": 2, "page": 1, "size": 100, "total_pages": 1 } }
}
```

### Search Operation

```javascript
app.use('/persons', search(Person, {
  aliases: {
    name: 'person_name',
    age: 'person_age'
  },
  path: '/'
}));
```

Request:
```http
POST /persons
Content-Type: application/json

{
  "filtering": { "name": "Jane", "age": { "gte": 25 } },
  "ordering": [{ "order_by": "age", "direction": "DESC" }],
  "paging": { "page": 1, "size": 10 }
}
```

### Single Operation

```javascript
app.use('/persons', single(Person, {
  aliases: {
    name: 'person_name',
    age: 'person_age',
    email: 'person_email'
  }
}));

// GET /persons/1
```

Response:
```json
{
  "success": true,
  "record": {
    "id": 1,
    "name": "John Doe",
    "age": 30,
    "email": "john@example.com"
  }
}
```

### Create Operation

```javascript
app.use('/persons', create(Person, {
  aliases: {
    name: 'person_name',
    age: 'person_age',
    email: 'person_email'
  }
}));
```

Request:
```http
POST /persons
Content-Type: application/json

{
  "name": "Alice Cooper",
  "age": 28,
  "email": "alice@example.com"
}
```

The data is automatically mapped to internal column names before saving.

### Patch Operation

```javascript
app.use('/persons', patch(Person, {
  aliases: {
    name: 'person_name',
    age: 'person_age'
  }
}));
```

Request:
```http
PATCH /persons/1
Content-Type: application/json

{
  "age": 31
}
```

### Bulk Create with Aliases

```javascript
app.use('/persons', create(Person, {
  aliases: {
    name: 'person_name',
    age: 'person_age'
  },
  allow_bulk_create: true
}));
```

Request:
```http
POST /persons
Content-Type: application/json

[
  { "name": "Alice", "age": 28 },
  { "name": "Bob", "age": 32 }
]
```

## Best Practices

### 1. Be Consistent

Apply the same aliases across all operations for a resource:

```javascript
const personAliases = {
  name: 'person_name',
  age: 'person_age',
  email: 'person_email'
};

app.use('/persons', list(Person, { aliases: personAliases }));
app.use('/persons', single(Person, { aliases: personAliases }));
app.use('/persons', create(Person, { aliases: personAliases }));
app.use('/persons', patch(Person, { aliases: personAliases }));
```

### 2. Document Your API

When using aliases, document the external field names in your API documentation, not the internal column names.

### 3. Use External Names in Configuration

Always use external (aliased) names when configuring:
- `allow_filtering_on` / `block_filtering_on`
- `allow_ordering_on` / `block_ordering_on`
- `allowed_fields` / `blocked_fields`
- `default_order_by`

### 4. Handle Unaliased Fields

Fields without aliases are passed through unchanged. You don't need to alias every field—only those you want to rename.

```javascript
// Only 'name' is aliased; 'active' uses its column name directly
const aliases = {
  name: 'person_name'
};

// Both work:
// GET /persons?name=John (uses alias)
// GET /persons?active=true (uses column name directly)
```

### 5. Testing

When testing, use the external field names in your API requests and assertions:

```javascript
// Correct: Use external names
const response = await request(app).get('/persons?name=John');
expect(response.body.data[0].name).toBe('John');

// Incorrect: Don't use internal column names in tests
// const response = await request(app).get('/persons?person_name=John');
```
