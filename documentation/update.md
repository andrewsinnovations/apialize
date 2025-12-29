# Update Operation

The `update` operation provides a PUT endpoint for fully replacing an existing record with validation, field controls, and transaction support.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Configuration Options](#configuration-options)
- [Request Format](#request-format)
- [Response Format](#response-format)
- [Examples](#examples)
- [Update vs Patch](#update-vs-patch)
- [Error Handling](#error-handling)

## Basic Usage

```javascript
const { update } = require('apialize');

// Item is a sequelize model
app.use('/items', update(Item));
```

This creates a `PUT /items/:id` endpoint.

## Default Usage (No Configuration)

With no configuration, the update operation provides full functionality out of the box:

### Example Request

```http
PUT /items/1
Content-Type: application/json

{
  "name": "Updated Item",
  "category": "electronics",
  "price": 149.99
}
```

### Example Response

```json
{
  "success": true
}
```

### Default Behavior

| Feature | Default Value |
|---------|---------------|
| Validation | Enabled |
| ID mapping | `id` |
| Allowed fields | All fields allowed |
| Blocked fields | None |
| Auto relation ID mapping | Enabled |

### Full Replacement Behavior

Unlike PATCH, PUT replaces the entire record. Fields not provided in the request body are set to their default values or `null`:

```http
PUT /items/1
Content-Type: application/json

{
  "name": "Updated Name"
}
```

If the original record had `category: "electronics"` and `price: 99.99`, after this PUT request:
- `name` = "Updated Name" (from request)
- `category` = null or default (not provided)
- `price` = null or default (not provided)

## Configuration Options

The `update` function accepts three parameters:

```javascript
update(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowed_fields` | `Array<string>` \| `null` | `null` | Whitelist of fields that can be set during update |
| `blocked_fields` | `Array<string>` \| `null` | `null` | Blacklist of fields that cannot be set during update |
| `validate` | `boolean` | `true` | Enable/disable Sequelize model validation |
| `id_mapping` | `string` | `'id'` | Field to use as the resource identifier |
| `relation_id_mapping` | `Object` | `null` | Configure ID mapping for related models |
| `auto_relation_id_mapping` | `boolean` | `true` | Automatically map foreign key IDs based on related model id_mapping |
| `middleware` | `Array<Function>` | `[]` | Express middleware functions to run before the operation |
| `pre` | `Function` \| `Array<Function>` | `null` | Hook(s) called before record update. See [Hooks](hooks.md) |
| `post` | `Function` \| `Array<Function>` | `null` | Hook(s) called after record update |
| `aliases` | `Object` | `null` | Map external field names to internal column names. See [Field Aliasing](aliasing.md) |

#### Field Control Options

##### `allowed_fields`
- **Type:** `Array<string>` or `null`
- **Default:** `null` (all fields allowed)
- **Description:** Whitelist of fields that can be set during update. When set, only these fields are accepted in the request body.

```javascript
app.use('/items', update(Item, {
  allowed_fields: ['name', 'description', 'price']
}));

// Allowed: PUT /items/1 with { "name": "New Name", "price": 99.99 }
// Blocked: PUT /items/1 with { "cost": 50 } (returns 400)
```

##### `blocked_fields`
- **Type:** `Array<string>` or `null`
- **Default:** `null`
- **Description:** Blacklist of fields that cannot be set during update. Takes precedence over `allowed_fields`.

```javascript
app.use('/items', update(Item, {
  blocked_fields: ['cost', 'internal_notes', 'created_by']
}));

// Blocked: PUT /items/1 with { "name": "Product", "cost": 50 }
// Allowed: PUT /items/1 with { "name": "Product", "price": 99.99 }
```

##### Using Both `allowed_fields` and `blocked_fields`

When both are specified, `blocked_fields` takes precedence:

```javascript
app.use('/items', update(Item, {
  allowed_fields: ['name', 'description', 'price', 'cost'],
  blocked_fields: ['cost']  // cost is blocked even though it's in allowed_fields
}));
```

#### Validation Options

##### `validate`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Enable or disable Sequelize model validation before updating the record. Unlike patch, update validates all fields (full validation). Note: To fully skip validation, you may also need to pass `{ validate: false }` in modelOptions.

```javascript
app.use('/items', update(Item, {
  validate: false  // Skip apialize validation
}, {
  validate: false  // Skip Sequelize validation
}));
```

#### ID Mapping

##### `id_mapping`
- **Type:** `string`
- **Default:** `'id'`
- **Description:** Field to use as the resource identifier. Records are looked up by this field from the URL parameter.

```javascript
app.use('/items', update(Item, {
  id_mapping: 'external_id'
}));

// PUT /items/uuid-123 looks up record where external_id = 'uuid-123'
// Response: { "success": true }
```

#### Relation ID Mapping

##### `relation_id_mapping`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Configure ID mapping for related models when setting foreign keys.

```javascript
app.use('/items', update(Item, {
  relation_id_mapping: [{ model: Category, id_field: 'external_id' }]
}));

// Request body can use external_id for category:
// { "name": "Product", "category_id": "cat-uuid-123" }
// Internally maps to the Category's internal id
```

##### `auto_relation_id_mapping`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Automatically map foreign key IDs based on related model's `id_mapping` configuration.

#### Middleware

##### `middleware`
- **Type:** `Array<Function>`
- **Default:** `[]`
- **Description:** Array of Express middleware functions to run before the update operation. Middleware can modify `req.apialize.values` to override field values or apply additional filters.

```javascript
const enforceOwnership = (req, res, next) => {
  // Only allow users to update their own records
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', update(Item, {
  middleware: [enforceOwnership]
}));
```

##### Modifying Values in Middleware

```javascript
const setUpdatedBy = (req, res, next) => {
  req.apialize.values = {
    ...(req.apialize.values || {}),
    updated_by: req.user.id
  };
  next();
};

app.use('/items', update(Item, {
  middleware: [setUpdatedBy]
}));
```

#### Hooks

##### `pre`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called before record update. Runs within the database transaction. Can return data to pass to post hooks. See [Hooks](hooks.md) for comprehensive documentation.

```javascript
app.use('/items', update(Item, {
  pre: async (context) => {
    console.log('Transaction:', context.transaction);
    return { startTime: Date.now() };
  }
}));
```

##### `post`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called after record update. Can access the pre hook result and modify the response payload.

```javascript
app.use('/items', update(Item, {
  post: async (context) => {
    console.log('Pre hook result:', context.preResult);
    // Modify the response payload
    context.payload.updated = true;
  }
}));
```

##### Multiple Hooks

Both `pre` and `post` can accept arrays of functions that execute in order:

```javascript
app.use('/items', update(Item, {
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
app.use('/items', update(Item, {
  aliases: {
    'title': 'name',
    'type': 'category'
  }
}));

// Client sends: { "title": "New Title", "type": "electronics" }
// Internally mapped to: { "name": "New Title", "category": "electronics" }
```

### Model Options Parameter

Standard Sequelize options that are merged into the update query:

```javascript
app.use('/items', update(Item, {}, {
  returning: true,              // Return updated attributes
  transaction: externalTransaction  // Use external transaction
}));
```

## Request Format

The request body should contain all fields for the record (full replacement):

```http
PUT /items/1
Content-Type: application/json

{
  "name": "Updated Item",
  "category": "electronics",
  "price": 149.99,
  "description": "Full product description"
}
```

### Full Replacement

PUT replaces the entire record. Unprovided fields are set to defaults or null:

```http
PUT /items/1
Content-Type: application/json

{
  "name": "Only Name Provided"
}
```

This will set all other fields to their default values or null.

## Response Format

### Successful Update

```json
{
  "success": true
}
```

### With Post Hook Modifications

```json
{
  "success": true,
  "updated": true
}
```

## Examples

### Basic Update

```javascript
const { update } = require('apialize');

app.use('/items', update(Item));

// PUT /items/1
// Body: { "name": "New Product", "price": 29.99, "category": "home" }
// Response: { "success": true }
```

### Restricted Fields

```javascript
app.use('/items', update(Item, {
  allowed_fields: ['name', 'description', 'price'],
  blocked_fields: ['cost', 'internal_notes']
}));
```

### With Ownership Scoping

```javascript
const enforceOwnership = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', update(Item, {
  middleware: [enforceOwnership]
}));

// If user 1 tries to update item belonging to user 2: 404 Not Found
```

### Custom ID Mapping

```javascript
app.use('/items', update(Item, {
  id_mapping: 'external_id'
}));

// PUT /items/uuid-123
// Body: { "name": "Updated Name", "price": 150 }
// Response: { "success": true }
```

### With Hooks

```javascript
app.use('/items', update(Item, {
  pre: async (context) => {
    console.log('Starting update');
    return { startTime: Date.now() };
  },
  post: async (context) => {
    const duration = Date.now() - context.preResult.startTime;
    context.payload.duration = duration;
  }
}));
```

### Middleware Value Override

```javascript
const lockStatus = (req, res, next) => {
  req.apialize.values = {
    ...(req.apialize.values || {}),
    status: 'active'  // Always set status to 'active'
  };
  next();
};

app.use('/items', update(Item, {
  middleware: [lockStatus]
}));
```

### With Field Aliases

```javascript
app.use('/items', update(Item, {
  aliases: {
    'title': 'name',
    'type': 'category'
  }
}));

// PUT /items/1
// Body: { "title": "New Title", "type": "electronics", "price": 99.99 }
// Updates name, category, and price fields in the database
```

## Update vs Patch

| Feature | Update (PUT) | Patch (PATCH) |
|---------|--------------|---------------|
| **HTTP Method** | PUT | PATCH |
| **Update Style** | Full - replaces entire record | Partial - only provided fields |
| **Unprovided Fields** | Set to null/default | Remain unchanged |
| **Validation** | Validates all required fields | Only validates provided fields |
| **Use Case** | Replacing complete record | Updating specific fields |

### Example Comparison

Given an existing record:
```json
{ "id": 1, "name": "Widget", "price": 100, "status": "active" }
```

**PUT /items/1** with `{ "price": 150 }`:
```json
{ "id": 1, "name": null, "price": 150, "status": null }
```
Fields not provided are set to null/default.

**PATCH /items/1** with `{ "price": 150 }`:
```json
{ "id": 1, "name": "Widget", "price": 150, "status": "active" }
```
Only `price` changes, other fields remain unchanged.

## Error Handling

### 404 Not Found

Returned when the record doesn't exist:

```json
{
  "success": false,
  "error": "Record not found"
}
```

### 400 Bad Request

Returned for validation errors or blocked fields:

```json
{
  "success": false,
  "error": "Field 'cost' is not allowed"
}
```

### Validation Errors

```json
{
  "success": false,
  "error": "Validation error: name cannot be empty"
}
```

### Transaction Support

All update operations run within a transaction. If validation or hooks fail, the transaction is rolled back automatically:

```javascript
app.use('/items', update(Item, {
  pre: async (context) => {
    // If this throws, the transaction is rolled back
    if (context.nextValues.price < 0) {
      throw new Error('Price cannot be negative');
    }
  }
}));
```

## See Also

- [patch](patch.md) - Partial record updates
- [create](create.md) - Create new records
