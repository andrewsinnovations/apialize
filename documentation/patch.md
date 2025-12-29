# Patch Operation

The `patch` operation provides a PATCH endpoint for partially updating an existing record with validation, field controls, and transaction support.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Configuration Options](#configuration-options)
- [Request Format](#request-format)
- [Response Format](#response-format)
- [Examples](#examples)
- [Patch vs Update](#patch-vs-update)
- [Error Handling](#error-handling)

## Basic Usage

```javascript
const { patch } = require('apialize');

// Item is a sequelize model
app.use('/items', patch(Item));
```

This creates a `PATCH /items/:id` endpoint.

## Default Usage (No Configuration)

With no configuration, the patch operation provides full functionality out of the box:

### Example Request

```http
PATCH /items/1
Content-Type: application/json

{
  "price": 149.99
}
```

### Example Response

```json
{
  "success": true,
  "id": "1"
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

## Configuration Options

The `patch` function accepts three parameters:

```javascript
patch(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowed_fields` | `Array<string>` \| `null` | `null` | Whitelist of fields that can be updated |
| `blocked_fields` | `Array<string>` \| `null` | `null` | Blacklist of fields that cannot be updated |
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
- **Description:** Whitelist of fields that can be updated. When set, only these fields are accepted in the request body.

```javascript
app.use('/items', patch(Item, {
  allowed_fields: ['name', 'description', 'price']
}));

// Allowed: PATCH /items/1 with { "name": "New Name" }
// Blocked: PATCH /items/1 with { "cost": 50 } (returns 400)
```

##### `blocked_fields`
- **Type:** `Array<string>` or `null`
- **Default:** `null`
- **Description:** Blacklist of fields that cannot be updated. Takes precedence over `allowed_fields`.

```javascript
app.use('/items', patch(Item, {
  blocked_fields: ['cost', 'internal_notes', 'created_by']
}));

// Blocked: PATCH /items/1 with { "cost": 50 }
// Allowed: PATCH /items/1 with { "name": "New Name" }
```

##### Using Both `allowed_fields` and `blocked_fields`

When both are specified, `blocked_fields` takes precedence:

```javascript
app.use('/items', patch(Item, {
  allowed_fields: ['name', 'description', 'price', 'cost'],
  blocked_fields: ['cost']  // cost is blocked even though it's in allowed_fields
}));
```

#### Validation Options

##### `validate`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Enable or disable Sequelize model validation before updating the record. When patching, only the provided fields are validated. Note: To fully skip validation, you may also need to pass `{ validate: false }` in modelOptions.

```javascript
app.use('/items', patch(Item, {
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
app.use('/items', patch(Item, {
  id_mapping: 'external_id'
}));

// PATCH /items/uuid-123 looks up record where external_id = 'uuid-123'
// Response: { "success": true, "id": "uuid-123" }
```

#### Relation ID Mapping

##### `relation_id_mapping`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Configure ID mapping for related models when updating foreign keys.

```javascript
app.use('/items', patch(Item, {
  relation_id_mapping: [{ model: Category, id_field: 'external_id' }]
}));

// Request body can use external_id for category:
// { "category_id": "cat-uuid-123" }
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
- **Description:** Array of Express middleware functions to run before the patch operation. Middleware can modify `req.apialize.values` to override field values or apply additional filters.

```javascript
const enforceOwnership = (req, res, next) => {
  // Only allow users to update their own records
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', patch(Item, {
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

app.use('/items', patch(Item, {
  middleware: [setUpdatedBy]
}));
```

#### Hooks

##### `pre`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called before record update. Runs within the database transaction. Can return data to pass to post hooks. See [Hooks](hooks.md) for comprehensive documentation.

```javascript
app.use('/items', patch(Item, {
  pre: async (context) => {
    console.log('About to update record');
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
app.use('/items', patch(Item, {
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
app.use('/items', patch(Item, {
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
app.use('/items', patch(Item, {
  aliases: {
    'title': 'name',
    'type': 'category'
  }
}));

// Client sends: { "title": "New Title" }
// Internally mapped to: { "name": "New Title" }
```

### Model Options Parameter

Standard Sequelize options that are merged into the update query:

```javascript
app.use('/items', patch(Item, {}, {
  returning: true,              // Return updated attributes
  transaction: externalTransaction  // Use external transaction
}));
```

## Request Format

The request body should contain only the fields to update:

```http
PATCH /items/1
Content-Type: application/json

{
  "price": 149.99
}
```

### Partial Updates

Only the fields provided in the request body are updated. Other fields remain unchanged:

```http
PATCH /items/1
Content-Type: application/json

{
  "name": "New Name",
  "status": "inactive"
}
```

### Empty Body

An empty body is allowed and simply verifies the record exists:

```http
PATCH /items/1
Content-Type: application/json

{}
```

Response: `{ "success": true, "id": "1" }` if record exists, or `404 Not Found` otherwise.

## Response Format

### Successful Update

```json
{
  "success": true,
  "id": "1"
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
  "id": "1",
  "updated": true
}
```

## Examples

### Basic Patch

```javascript
const { patch } = require('apialize');

app.use('/items', patch(Item));

// PATCH /items/1
// Body: { "price": 79.99 }
// Response: { "success": true, "id": "1" }
```

### Restricted Fields

```javascript
app.use('/items', patch(Item, {
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

app.use('/items', patch(Item, {
  middleware: [enforceOwnership]
}));

// If user 1 tries to patch item belonging to user 2: 404 Not Found
```

### Custom ID Mapping

```javascript
app.use('/items', patch(Item, {
  id_mapping: 'external_id'
}));

// PATCH /items/uuid-123
// Body: { "name": "Updated Name" }
// Response: { "success": true, "id": "uuid-123" }
```

### With Hooks

```javascript
app.use('/items', patch(Item, {
  pre: async (context) => {
    console.log('Starting patch');
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
const lockDescription = (req, res, next) => {
  req.apialize.values = {
    ...(req.apialize.values || {}),
    description: 'locked'  // Always set description to 'locked'
  };
  next();
};

app.use('/items', patch(Item, {
  middleware: [lockDescription]
}));
```

### With Field Aliases

```javascript
app.use('/items', patch(Item, {
  aliases: {
    'title': 'name',
    'type': 'category'
  }
}));

// PATCH /items/1
// Body: { "title": "New Title", "type": "electronics" }
// Updates name and category fields in the database
```

## Patch vs Update

| Feature | Patch (PATCH) | Update (PUT) |
|---------|--------------|--------------|
| **HTTP Method** | PATCH | PUT |
| **Update Style** | Partial - only provided fields | Full - replaces entire record |
| **Unprovided Fields** | Remain unchanged | May be set to null/default |
| **Validation** | Only validates provided fields | Validates all required fields |
| **Use Case** | Updating specific fields | Replacing complete record |

### Example Comparison

Given an existing record:
```json
{ "id": 1, "name": "Widget", "price": 100, "status": "active" }
```

**PATCH /items/1** with `{ "price": 150 }`:
```json
{ "id": 1, "name": "Widget", "price": 150, "status": "active" }
```
Only `price` changes.

**PUT /items/1** with `{ "price": 150 }`:
```json
{ "id": 1, "name": null, "price": 150, "status": null }
```
Fields not provided may be nullified.

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
  "error": "Validation error: price must be a positive number"
}
```

### Transaction Support

All patch operations run within a transaction. If validation or hooks fail, the transaction is rolled back automatically:

```javascript
app.use('/items', patch(Item, {
  pre: async (context) => {
    // If this throws, the transaction is rolled back
    if (context.values.price < 0) {
      throw new Error('Price cannot be negative');
    }
  }
}));
```

## See Also

- [update](update.md) - Full record replacement
- [create](create.md) - Create new records
