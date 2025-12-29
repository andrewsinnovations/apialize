# CRUD Operation

The `crud` function is a convenience method that mounts all CRUD operations at once, providing a complete RESTful API for a Sequelize model with a single function call.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Endpoints Created](#endpoints-created)
- [Configuration Options](#configuration-options)
- [Examples](#examples)
- [Selective Operations](#selective-operations)
- [See Also](#see-also)

## Basic Usage

```javascript
const { crud } = require('apialize');

// Item is a sequelize model
app.use('/items', crud(Item));
```

This single line creates a complete RESTful API with seven endpoints.

## Default Usage (No Configuration)

With no configuration, `crud` provides a fully functional REST API:

```javascript
const express = require('express');
const { crud } = require('apialize');
const { Item } = require('./models');

const app = express();
app.use(express.json());

app.use('/items', crud(Item));

app.listen(3000);
```

## Endpoints Created

The `crud` function creates the following endpoints:

| Method | Endpoint | Operation | Description | Documentation |
|--------|----------|-----------|-------------|---------------|
| `GET` | `/items` | [list](list.md) | Retrieve all items with filtering, sorting, and pagination | [List Documentation](list.md) |
| `POST` | `/items/search` | [search](search.md) | Search items with POST body filters | [Search Documentation](search.md) |
| `GET` | `/items/:id` | [single](single.md) | Retrieve a single item by ID | [Single Documentation](single.md) |
| `POST` | `/items` | [create](create.md) | Create a new item | [Create Documentation](create.md) |
| `PUT` | `/items/:id` | [update](update.md) | Full replacement update of an item | [Update Documentation](update.md) |
| `PATCH` | `/items/:id` | [patch](patch.md) | Partial update of an item | [Patch Documentation](patch.md) |
| `DELETE` | `/items/:id` | [destroy](destroy.md) | Delete an item | [Destroy Documentation](destroy.md) |

### Endpoint Details

#### GET /items - List Records
Retrieves a collection of records with support for filtering, sorting, and pagination.

```http
GET /items?category=electronics&api:order_by=-price&api:page_size=10
```

See [List Documentation](list.md) for filtering operators, ordering syntax, and pagination options.

#### POST /items/search - Search Records
Similar to list, but accepts filters in the request body for complex queries.

```http
POST /items/search
Content-Type: application/json

{
  "category": "electronics",
  "price:gte": 100
}
```

See [Search Documentation](search.md) for search-specific options.

#### GET /items/:id - Get Single Record
Retrieves a single record by its identifier.

```http
GET /items/1
```

See [Single Documentation](single.md) for association loading and response formatting.

#### POST /items - Create Record
Creates a new record from the request body.

```http
POST /items
Content-Type: application/json

{
  "name": "New Product",
  "category": "electronics",
  "price": 99.99
}
```

See [Create Documentation](create.md) for field validation, allowed/blocked fields, and bulk create options.

#### PUT /items/:id - Update Record (Full Replacement)
Replaces an entire record. Fields not provided are set to null or defaults.

```http
PUT /items/1
Content-Type: application/json

{
  "name": "Updated Product",
  "category": "home",
  "price": 149.99,
  "description": "Full product description"
}
```

See [Update Documentation](update.md) for full replacement semantics and validation.

#### PATCH /items/:id - Patch Record (Partial Update)
Updates only the provided fields. Other fields remain unchanged.

```http
PATCH /items/1
Content-Type: application/json

{
  "price": 79.99
}
```

See [Patch Documentation](patch.md) for partial update behavior and field controls.

#### DELETE /items/:id - Delete Record
Removes a record by its identifier.

```http
DELETE /items/1
```

See [Destroy Documentation](destroy.md) for soft delete support and ownership scoping.

## Configuration Options

The `crud` function accepts three parameters:

```javascript
crud(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `middleware` | `Array<Function>` | `[]` | Middleware functions applied to all routes |
| `routes` | `Object` | `{}` | Per-route middleware configuration |

#### `middleware`
- **Type:** `Array<Function>`
- **Default:** `[]`
- **Description:** Middleware functions that apply to all CRUD routes. Common uses include authentication, logging, and request validation.

```javascript
app.use('/items', crud(Item, {
  middleware: [authMiddleware, logMiddleware]
}));
```

#### `routes`
- **Type:** `Object`
- **Default:** `{}`
- **Description:** Per-route middleware configuration. Keys are route names (`list`, `search`, `single`, `create`, `update`, `patch`, `destroy`), values are arrays of middleware functions.

```javascript
app.use('/items', crud(Item, {
  routes: {
    list: [cacheMiddleware],
    create: [validateMiddleware],
    update: [validateMiddleware],
    patch: [validateMiddleware],
    destroy: [adminOnlyMiddleware]
  }
}));
```

### Model Options Parameter

Sequelize model options that are passed to all operations. These control query behavior like included associations, attributes, and default conditions.

```javascript
app.use('/items', crud(Item, {}, {
  include: [{ model: Category }],
  attributes: ['id', 'name', 'price'],
  where: { archived: false }
}));
```

| Option | Description |
|--------|-------------|
| `include` | Associations to eagerly load |
| `attributes` | Fields to include/exclude in responses |
| `where` | Default query conditions applied to all operations |
| `order` | Default ordering for list/search operations |

## Examples

### Basic CRUD

```javascript
const { crud } = require('apialize');
const { Item } = require('./models');

app.use('/items', crud(Item));
```

### CRUD with Authentication

```javascript
const authMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use('/items', crud(Item, {
  middleware: [authMiddleware]
}));
```

### CRUD with Ownership Scoping

Scope all operations to the authenticated user's records:

```javascript
const scopeToUser = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', crud(Item, {
  middleware: [authMiddleware, scopeToUser]
}));
```

### CRUD with Route-Specific Middleware

```javascript
app.use('/items', crud(Item, {
  middleware: [authMiddleware],
  routes: {
    list: [cacheMiddleware],
    create: [validateCreateMiddleware],
    update: [validateUpdateMiddleware],
    patch: [validatePatchMiddleware],
    destroy: [adminOnlyMiddleware]
  }
}));
```

### CRUD with Associations

```javascript
app.use('/items', crud(Item, {}, {
  include: [
    { model: Category, as: 'category' },
    { model: Tag, as: 'tags' }
  ],
  order: [['created_at', 'DESC']]
}));
```

### CRUD with Filtered Attributes

Only expose specific fields:

```javascript
app.use('/items', crud(Item, {}, {
  attributes: ['id', 'name', 'category', 'price'],
  // Excludes internal fields like cost, internal_notes, etc.
}));
```

### CRUD with Default Conditions

Only show non-archived items:

```javascript
app.use('/items', crud(Item, {}, {
  where: { archived: false }
}));
```

### Multiple Resources

```javascript
const { crud } = require('apialize');
const { Item, Category, User, Order } = require('./models');

app.use('/items', crud(Item));
app.use('/categories', crud(Category));
app.use('/users', crud(User, { middleware: [adminOnly] }));
app.use('/orders', crud(Order, { middleware: [authMiddleware, scopeToUser] }));
```

## Selective Operations

If you only need specific operations rather than the full CRUD, import them individually:

```javascript
const { list, single, create, patch } = require('apialize');

// Read-only API
app.use('/items', list(Item));
app.use('/items', single(Item));

// Or create and update only
app.use('/items', create(Item));
app.use('/items', patch(Item));
```

This approach gives you fine-grained control over which operations are available and allows different configuration for each operation.

```javascript
const { list, single, create, patch, destroy } = require('apialize');

// Different options for different operations
app.use('/items', list(Item, { 
  default_page_size: 50,
  allow_filtering_on: ['category', 'status']
}));

app.use('/items', single(Item, {
  id_mapping: 'external_id'
}));

app.use('/items', create(Item, { 
  allowed_fields: ['name', 'description', 'price'],
  blocked_fields: ['internal_notes']
}));

app.use('/items', patch(Item, { 
  allowed_fields: ['name', 'description', 'price', 'status']
}));

app.use('/items', destroy(Item, { 
  middleware: [adminOnlyMiddleware]
}));
```

## See Also

- [list](list.md) - List operation with filtering, sorting, and pagination
- [search](search.md) - Search operation with POST body filters
- [single](single.md) - Single record retrieval
- [create](create.md) - Record creation with validation and bulk insert
- [update](update.md) - Full record replacement (PUT)
- [patch](patch.md) - Partial record updates (PATCH)
- [destroy](destroy.md) - Record deletion
- [filtering](filtering.md) - Filter operators and syntax
