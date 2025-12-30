# Destroy Operation

The `destroy` operation provides a DELETE endpoint for removing records by ID with support for ownership scoping and hooks.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Configuration Options](#configuration-options)
- [Request Format](#request-format)
- [Response Format](#response-format)
- [Examples](#examples)
- [Error Handling](#error-handling)

## Basic Usage

```javascript
const { destroy } = require('apialize');

// Item is a sequelize model
app.use('/items', destroy(Item));
```

This creates a `DELETE /items/:id` endpoint.

## Default Usage (No Configuration)

With no configuration, the destroy operation provides full functionality out of the box:

### Example Request

```http
DELETE /items/1
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
| ID mapping | `id` |
| Middleware | None |
| Pre hooks | None |
| Post hooks | None |

## Configuration Options

The `destroy` function accepts three parameters:

```javascript
destroy(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `id_mapping` | `string` | `'id'` | Field to use as the resource identifier |
| `middleware` | `Array<Function>` | `[]` | Express middleware functions to run before the operation |
| `pre` | `Function` \| `Array<Function>` | `null` | Hook(s) called before record deletion. See [Hooks](hooks.md) |
| `post` | `Function` \| `Array<Function>` | `null` | Hook(s) called after record deletion |

#### ID Mapping

##### `id_mapping`
- **Type:** `string`
- **Default:** `'id'`
- **Description:** Field to use as the resource identifier. When set, records are looked up by this field instead of the default `id`.

```javascript
app.use('/items', destroy(Item, {
  id_mapping: 'external_id'
}));

// DELETE /items/uuid-abc-123
// Deletes record where external_id = 'uuid-abc-123'
```

#### Middleware

##### `middleware`
- **Type:** `Array<Function>`
- **Default:** `[]`
- **Description:** Array of Express middleware functions to run before the destroy operation. Middleware can scope deletions to specific records using `req.apialize.apply_where()`.

```javascript
const scopeToUser = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', destroy(Item, {
  middleware: [scopeToUser]
}));

// Only deletes items belonging to the authenticated user
```

#### Hooks

##### `pre`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called before record deletion. Runs within the database transaction. Can access `context.id` and `context.where` to inspect what will be deleted. Can return data to pass to post hooks. See [Hooks](hooks.md) for comprehensive documentation.

```javascript
app.use('/items', destroy(Item, {
  pre: async (context) => {
    console.log('About to delete record:', context.id);
    console.log('Where clause:', context.where);
    console.log('Transaction:', context.transaction);
    return { deletedId: context.id };
  }
}));
```

##### `post`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called after record deletion. Can access the pre hook result and modify the response payload.

```javascript
app.use('/items', destroy(Item, {
  post: async (context) => {
    console.log('Deleted record:', context.id);
    console.log('Pre hook result:', context.preResult);
    // Modify the response payload
    context.payload.deletedAt = new Date().toISOString();
  }
}));
```

##### Multiple Hooks

Both `pre` and `post` can accept arrays of functions that execute in order:

```javascript
app.use('/items', destroy(Item, {
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

## Request Format

### Delete by ID

```http
DELETE /items/1
```

### Delete with Query Parameters (Ownership Scoping)

Query parameters can be used to add additional where conditions:

```http
DELETE /items/1?user_id=42
```

This will only delete the record if both `id = 1` AND `user_id = 42`.

## Response Format

### Successful Deletion

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
  "deletedAt": "2025-01-01T00:00:00.000Z"
}
```

## Examples

### Basic Delete

```javascript
const { destroy } = require('apialize');

app.use('/items', destroy(Item));

// DELETE /items/1
// Response: { "success": true, "id": "1" }
```

### Custom ID Mapping with UUID

```javascript
app.use('/items', destroy(Item, {
  id_mapping: 'external_id'
}));

// DELETE /items/uuid-abc-123
// Deletes record where external_id = 'uuid-abc-123'
// Response: { "success": true, "id": "uuid-abc-123" }
```

### With Authentication Scoping

```javascript
const scopeToUser = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', destroy(Item, {
  middleware: [scopeToUser]
}));

// Only allows deleting items owned by the authenticated user
// Returns 404 if the item doesn't belong to the user
```

### With Parent Scoping

```javascript
const scopeToParent = (req, res, next) => {
  req.apialize.apply_where({ parent_id: req.params.parentId });
  next();
};

app.use('/items', destroy(Item, {
  middleware: [scopeToParent]
}));
```

### With Pre/Post Hooks

```javascript
app.use('/items', destroy(Item, {
  pre: async (context) => {
    console.log('Deleting record:', context.id);
    // Could log to audit trail, check permissions, etc.
    return { deletedId: context.id };
  },
  post: async (context) => {
    console.log('Record deleted successfully');
    context.payload.deletedAt = new Date().toISOString();
  }
}));
```

### With Multiple Hooks

```javascript
app.use('/items', destroy(Item, {
  pre: [
    async (ctx) => {
      console.log('Pre hook 1: Logging deletion');
      return { step: 1 };
    },
    async (ctx) => {
      console.log('Pre hook 2: Checking permissions');
      return { step: 2 };
    }
  ],
  post: [
    async (ctx) => {
      ctx.payload.auditLogged = true;
    },
    async (ctx) => {
      ctx.payload.notificationSent = true;
    }
  ]
}));
```

### Soft Delete with Paranoid Mode

If your Sequelize model uses paranoid mode (soft deletes), the destroy operation will mark records as deleted rather than permanently removing them:

```javascript
const Item = sequelize.define('Item', {
  name: DataTypes.STRING
}, {
  paranoid: true  // Enables soft delete
});

app.use('/items', destroy(Item));

// DELETE /items/1
// Sets deleted_at timestamp instead of removing the record
```

## Error Handling

### Record Not Found (404)

When the record with the specified ID doesn't exist:

```json
{
  "success": false,
  "error": "Record not found"
}
```

### Ownership Scoping Failure (404)

When the record exists but doesn't match the ownership scope:

```http
DELETE /items/1?user_id=999
```

If item 1 belongs to user_id 42, this returns 404:

```json
{
  "success": false,
  "error": "Record not found"
}
```

### Foreign Key Constraint (500)

When the record cannot be deleted due to foreign key constraints:

```json
{
  "success": false,
  "error": "Cannot delete record: foreign key constraint"
}
```

## See Also

- [create](create.md) - Create new records
- [single](single.md) - Retrieve individual records
- [update](update.md) - Full record replacement
- [patch](patch.md) - Partial record updates
