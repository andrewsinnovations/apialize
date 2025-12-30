# Create Operation

The `create` operation provides a POST endpoint for creating new records with validation, field controls, and bulk insert support.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Configuration Options](#configuration-options)
- [Request Format](#request-format)
- [Response Format](#response-format)
- [Bulk Create](#bulk-create)
- [Examples](#examples)
- [Error Handling](#error-handling)

## Basic Usage

```javascript
const { create } = require('apialize');

// Item is a sequelize model
app.use('/items', create(Item));
```

This creates a `POST /items` endpoint.

## Default Usage (No Configuration)

With no configuration, the create operation provides full functionality out of the box:

### Example Request

```http
POST /items
Content-Type: application/json

{
  "name": "Laptop",
  "category": "electronics",
  "price": 999.99
}
```

### Example Response

```json
{
  "success": true,
  "id": 1
}
```

### Default Behavior

| Feature | Default Value |
|---------|---------------|
| Validation | Enabled |
| Bulk create | Disabled |
| ID mapping | `id` |
| Allowed fields | All fields allowed |
| Blocked fields | None |

## Configuration Options

The `create` function accepts three parameters:

```javascript
create(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowed_fields` | `Array<string>` \| `null` | `null` | Whitelist of fields that can be set during create |
| `blocked_fields` | `Array<string>` \| `null` | `null` | Blacklist of fields that cannot be set during create |
| `validate` | `boolean` | `true` | Enable/disable Sequelize model validation |
| `allow_bulk_create` | `boolean` | `false` | Enable/disable bulk insert with array body |
| `id_mapping` | `string` | `'id'` | Field to use as the resource identifier in response |
| `relation_id_mapping` | `Object` | `null` | Configure ID mapping for related models |
| `auto_relation_id_mapping` | `boolean` | `true` | Automatically map foreign key IDs based on related model id_mapping |
| `middleware` | `Array<Function>` | `[]` | Express middleware functions to run before the operation |
| `pre` | `Function` \| `Array<Function>` | `null` | Hook(s) called before record creation. See [Hooks](hooks.md) |
| `post` | `Function` \| `Array<Function>` | `null` | Hook(s) called after record creation |
| `aliases` | `Object` | `null` | Map external field names to internal column names. See [Field Aliasing](aliasing.md) |

#### Field Control Options

##### `allowed_fields`
- **Type:** `Array<string>` or `null`
- **Default:** `null` (all fields allowed)
- **Description:** Whitelist of fields that can be set during create. When set, only these fields are accepted in the request body.

```javascript
app.use('/items', create(Item, {
  allowed_fields: ['name', 'description', 'price']
}));

// Allowed: POST /items with { "name": "Product", "price": 99.99 }
// Blocked: POST /items with { "name": "Product", "cost": 50 } (returns 400)
```

##### `blocked_fields`
- **Type:** `Array<string>` or `null`
- **Default:** `null`
- **Description:** Blacklist of fields that cannot be set during create. Takes precedence over `allowed_fields`.

```javascript
app.use('/items', create(Item, {
  blocked_fields: ['cost', 'internal_notes', 'created_by']
}));

// Blocked: POST /items with { "name": "Product", "cost": 50 }
// Allowed: POST /items with { "name": "Product", "price": 99.99 }
```

##### Using Both `allowed_fields` and `blocked_fields`

When both are specified, `blocked_fields` takes precedence:

```javascript
app.use('/items', create(Item, {
  allowed_fields: ['name', 'description', 'price', 'cost'],
  blocked_fields: ['cost']  // cost is blocked even though it's in allowed_fields
}));
```

#### Validation Options

##### `validate`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Enable or disable Sequelize model validation before creating the record.

```javascript
app.use('/items', create(Item, {
  validate: false  // Skip model validation
}));
```

#### Bulk Create Options

##### `allow_bulk_create`
- **Type:** `boolean`
- **Default:** `false`
- **Description:** When `true`, allows creating multiple records by sending an array in the request body. The operation is atomic - if any record fails, all records are rolled back.

```javascript
app.use('/items', create(Item, {
  allow_bulk_create: true
}));

// POST /items with array body:
// [{ "name": "Item 1" }, { "name": "Item 2" }]
```

#### ID Mapping

##### `id_mapping`
- **Type:** `string`
- **Default:** `'id'`
- **Description:** Field to use as the resource identifier in the response. Useful when using UUIDs or external IDs.

```javascript
app.use('/items', create(Item, {
  id_mapping: 'external_id'
}));

// Response: { "success": true, "id": "uuid-123" }
```

#### Relation ID Mapping

##### `relation_id_mapping`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Configure ID mapping for related models when setting foreign keys.

```javascript
app.use('/items', create(Item, {
  relation_id_mapping: {
    'category': 'external_id'
  }
}));

// Request body can use external_id for category:
// { "name": "Product", "category_id": "cat-uuid-123" }
```

##### `auto_relation_id_mapping`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Automatically map foreign key IDs based on related model's `id_mapping` configuration.

#### Middleware

##### `middleware`
- **Type:** `Array<Function>`
- **Default:** `[]`
- **Description:** Array of Express middleware functions to run before the create operation. Middleware can modify `req.apialize.values` to override field values.

```javascript
const setCreatedBy = (req, res, next) => {
  req.apialize.values = {
    ...(req.apialize.values || {}),
    created_by: req.user.id
  };
  next();
};

app.use('/items', create(Item, {
  middleware: [setCreatedBy]
}));
```

#### Hooks

##### `pre`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called before record creation. Runs within the database transaction. Can return data to pass to post hooks. See [Hooks](hooks.md) for comprehensive documentation.

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    console.log('About to create record');
    console.log('Transaction:', context.transaction);
    return { startTime: Date.now() };
  }
}));
```

##### `post`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called after record creation. Can access the created record and modify the response payload.

```javascript
app.use('/items', create(Item, {
  post: async (context) => {
    console.log('Created record:', context.created);
    console.log('Pre hook result:', context.preResult);
    // Modify the response payload
    context.payload.extra = 'custom data';
  }
}));
```

##### Multiple Hooks

Both `pre` and `post` can accept arrays of functions that execute in order:

```javascript
app.use('/items', create(Item, {
  pre: [
    async (ctx) => { console.log('pre 1'); return { step: 1 }; },
    async (ctx) => { console.log('pre 2'); return { step: 2 }; }
  ],
  post: [
    async (ctx) => { ctx.payload.hook1 = true; },
    async (ctx) => { ctx.payload.hook2 = true; }
  ]
}));
```

#### Field Aliases

##### `aliases`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Map external field names to internal database column names. See [Field Aliasing](aliasing.md) for comprehensive documentation.

```javascript
app.use('/items', create(Item, {
  aliases: {
    'name': 'item_name',
    'category': 'item_category'
  }
}));

// Client sends: { "name": "Product" }
// Internally mapped to: { "item_name": "Product" }
```

### Model Options Parameter

Standard Sequelize options that are merged into the create query:

```javascript
app.use('/items', create(Item, {}, {
  fields: ['name', 'description', 'price'],  // Only allow these fields to be set
  returning: true,                            // Return created attributes
  transaction: externalTransaction            // Use external transaction
}));
```

## Request Format

### Single Record

```http
POST /items
Content-Type: application/json

{
  "name": "New Item",
  "category": "electronics",
  "price": 99.99
}
```

### Bulk Create (requires `allow_bulk_create: true`)

```http
POST /items
Content-Type: application/json

[
  { "name": "Item 1", "price": 29.99 },
  { "name": "Item 2", "price": 49.99 },
  { "name": "Item 3", "price": 19.99 }
]
```

## Response Format

### Single Record Response

```json
{
  "success": true,
  "id": 1
}
```

### Bulk Create Response

```json
{
  "success": true,
  "ids": [1, 2, 3]
}
```

### With Custom ID Mapping

When using `id_mapping: 'external_id'`:

```json
{
  "success": true,
  "id": "uuid-abc-123"
}
```

### With Post Hook Modifications

```json
{
  "success": true,
  "id": 1,
  "extra": "custom data"
}
```

## Bulk Create

Bulk create allows inserting multiple records in a single request. The operation is atomic - if any record fails validation or violates constraints, the entire batch is rolled back.

### Enabling Bulk Create

```javascript
app.use('/items', create(Item, {
  allow_bulk_create: true
}));
```

### Bulk Request Example

```http
POST /items
Content-Type: application/json

[
  { "external_id": "item-1", "name": "Product A", "price": 29.99 },
  { "external_id": "item-2", "name": "Product B", "price": 49.99 }
]
```

### Bulk Response

```json
{
  "success": true,
  "ids": [1, 2]
}
```

### Atomic Rollback

If any record in the batch fails, no records are created:

```http
POST /items
Content-Type: application/json

[
  { "external_id": "dup-1", "name": "Product A" },
  { "external_id": "dup-1", "name": "Duplicate" }  // Unique constraint violation
]
```

Response (400 or 500 depending on error handler):
```json
{
  "success": false,
  "error": "Validation error: external_id must be unique"
}
```

## Examples

### Basic Create

```javascript
const { create } = require('apialize');

app.use('/items', create(Item));

// POST /items
// Body: { "name": "New Product", "price": 29.99 }
// Response: { "success": true, "id": 1 }
```

### Restricted Fields

```javascript
app.use('/items', create(Item, {
  allowed_fields: ['name', 'description', 'price'],
  blocked_fields: ['cost', 'internal_notes']
}));
```

### With Authentication Scoping

```javascript
const setOwner = (req, res, next) => {
  req.apialize.values = {
    ...(req.apialize.values || {}),
    user_id: req.user.id,
    created_at: new Date()
  };
  next();
};

app.use('/items', create(Item, {
  middleware: [setOwner],
  blocked_fields: ['user_id', 'created_at']  // Prevent client from setting these
}));
```

### Custom ID Mapping with UUID

```javascript
app.use('/items', create(Item, {
  id_mapping: 'external_id'
}));

// POST /items
// Body: { "external_id": "uuid-abc-123", "name": "Product" }
// Response: { "success": true, "id": "uuid-abc-123" }
```

### With Pre/Post Hooks

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    console.log('Creating record...');
    return { startTime: Date.now() };
  },
  post: async (context) => {
    const duration = Date.now() - context.preResult.startTime;
    console.log(`Record created in ${duration}ms`);
    context.payload.creationTime = duration;
  }
}));
```

### Bulk Create with Field Controls

```javascript
app.use('/items', create(Item, {
  allow_bulk_create: true,
  allowed_fields: ['name', 'description', 'price'],
  validate: true
}));

// POST /items
// Body: [{ "name": "A", "price": 10 }, { "name": "B", "price": 20 }]
// Response: { "success": true, "ids": [1, 2] }
```

### With Field Aliases

```javascript
app.use('/items', create(Item, {
  aliases: {
    'productName': 'name',
    'productPrice': 'price'
  }
}));

// POST /items
// Body: { "productName": "Widget", "productPrice": 29.99 }
// Internally creates: { "name": "Widget", "price": 29.99 }
```

## Error Handling

### Field Not Allowed (400)

When a field is not in `allowed_fields` or is in `blocked_fields`:

```json
{
  "success": false,
  "error": "Field 'cost' is not allowed"
}
```

### Validation Error (400)

When Sequelize validation fails:

```json
{
  "success": false,
  "error": "Validation error: name cannot be null"
}
```

### Bulk Create Not Allowed (400)

When sending an array without `allow_bulk_create: true`:

```json
{
  "success": false,
  "error": "Cannot insert multiple records."
}
```

### Constraint Violation (400/500)

When a database constraint is violated:

```json
{
  "success": false,
  "error": "Validation error: external_id must be unique"
}
```

## See Also

- [update](update.md) - Full record replacement
- [patch](patch.md) - Partial record updates
- [list](list.md) - Retrieving collections of records
- [single](single.md) - Retrieving individual records
