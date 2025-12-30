# Apialize

**Apialize** transforms Sequelize database models into production-ready REST APIs with minimal configuration. Build complete CRUD endpoints with filtering, pagination, relationships, and hooks in just a few lines of code.

## Installation

```bash
npm install apialize
```

## What Does Apialize Do?

Apialize creates production-ready REST API endpoints directly from your Sequelize models with minimal code. Simply pass your model to an operation function, and you get a fully functional endpoint with extensive configuration options:

- **Easy Setup**: Transform models into API endpoints in a single line of code
- **Flexible Configuration**: Customize behavior with dozens of options for filtering, pagination, field control, and more
- **Granular Control**: Choose exactly which operations to expose for each resource
- **Advanced Filtering**: Query by any field with support for operators and predicates  
- **Relationship Handling**: Automatically include related models and manage foreign keys
- **Custom ID Fields**: Use UUIDs or any field as resource identifiers
- **Middleware Hooks**: Add authentication, validation, and transformation logic at any point
- **Field Mapping**: Alias external API field names to internal database columns
- **Nested Flattening**: Flatten relationships into parent responses for cleaner APIs
- **Complex Search**: Build sophisticated queries with multiple filters and conditions

## Quick Start

```javascript
const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const { list, single, create, update, patch, destroy } = require('apialize');

const sequelize = new Sequelize('sqlite::memory:');
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false }
});

await sequelize.sync();

const app = express();
app.use(express.json());

// Mount individual operations with full control
app.use('/users', list(User));
app.use('/users', single(User));
app.use('/users', create(User));
app.use('/users', patch(User));
app.use('/users', destroy(User));

app.listen(3000);
```

Each operation gives you precise control over your API endpoints!

## Available Operations & Endpoints

Apialize provides individual operation functions that give you precise control over which endpoints to expose.

| Operation | HTTP Method & Endpoint | Description | Documentation |
|-----------|----------------------|-------------|---------------|
| **list** | `GET /resource` | List all records with filtering, sorting, and pagination | [List Documentation](./documentation/list.md) |
| **single** | `GET /resource/:id` | Get a single record by ID | [Single Documentation](./documentation/single.md) |
| **create** | `POST /resource` | Create a new record | [Create Documentation](./documentation/create.md) |
| **update** | `PUT /resource/:id` | Replace a record (full update) | [Update Documentation](./documentation/update.md) |
| **patch** | `PATCH /resource/:id` | Partially update a record | [Patch Documentation](./documentation/patch.md) |
| **destroy** | `DELETE /resource/:id` | Delete a record | [Destroy Documentation](./documentation/destroy.md) |
| **search** | `POST /resource/search` | Advanced search with complex filters | [Search Documentation](./documentation/search.md) |

### Using Individual Operations

```javascript
const { list, single, create, update, patch, destroy, search } = require('apialize');

// Mount only the operations you need
app.use('/users', list(User));        // GET /users
app.use('/users', single(User));      // GET /users/:id
app.use('/users', create(User));      // POST /users
app.use('/users', update(User));      // PUT /users/:id
app.use('/users', patch(User));       // PATCH /users/:id
app.use('/users', destroy(User));     // DELETE /users/:id
app.use('/users', search(User));      // POST /users/search
```

## Configuration Options

Apialize accepts two types of configuration: **Apialize Options** and **Model Options**.

### Apialize Options

Configure Apialize-specific behaviors:

| Option | Type | Description | Applies To |
|--------|------|-------------|------------|
| `id_mapping` | string | Use a different field as the resource identifier | single, update, patch, destroy |
| `middleware` | array | Custom middleware functions for hooks | All operations |
| `default_page_size` | number | Default number of records per page | list, search |
| `allow_filtering_on` | array | Fields that can be used in filters | list, search |
| `allow_ordering_on` | array | Fields that can be used for sorting | list, search |
| `relation_id_mapping` | object | Map relationship IDs to custom fields | create, update, patch |
| `field_aliases` | object | Map external field names to database columns | All operations |

### Model Options

Standard Sequelize query options:

| Option | Type | Description | Applies To |
|--------|------|-------------|------------|
| `attributes` | array | Control which fields are returned | list, single, search |
| `fields` | array | Control which fields can be set | create, update, patch |
| `include` | array | Include related models | list, single, search |
| `where` | object | Apply fixed filters | list, search |
| `scope` | string | Use a Sequelize scope | All operations |

### Example: Combined Configuration

```javascript
app.use('/items', list(Item, 
  // Apialize options
  {
    middleware: [authMiddleware],
    default_page_size: 25,
    allow_filtering_on: ['category', 'status'],
    allow_ordering_on: ['created_at', 'name']
  },
  // Model options
  {
    attributes: ['id', 'name', 'category', 'status'],
    include: [{ model: User, as: 'owner' }]
  }
));
```

## Common Use Cases

### Authentication & Scoping

Automatically scope queries to the current user:

```javascript
const scopeToUser = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', list(Item, { middleware: [scopeToUser] }));
```

### Custom ID Fields

Use UUIDs or external IDs instead of auto-increment IDs:

```javascript
app.use('/users', single(User, { id_mapping: 'external_id' }));
// Access: GET /users/uuid-abc-123
```

### Field Aliases

Map external API field names to database columns:

```javascript
app.use('/users', list(User, {
  field_aliases: {
    'external_name': 'name',
    'user_email': 'email'
  }
}));
// Query: GET /users?external_name=John
```

### Including Relationships

Automatically include related models:

```javascript
app.use('/posts', list(Post, {}, {
  include: [
    { model: User, as: 'author' },
    { model: Comment, as: 'comments' }
  ]
}));
```

### Relationship ID Mapping

Allow setting relationships by custom ID fields:

```javascript
app.use('/posts', create(Post, {
  relation_id_mapping: {
    'author': 'external_id'
  }
}));
// POST /posts { "author_id": "uuid-123", ... }
```

## Advanced Features

For detailed information on advanced features, see the full documentation:

- **[Hooks & Middleware](./documentation/hooks.md)**: Add custom logic before and after operations
- **[Filtering](./documentation/filtering.md)**: Complex query filters and operators
- **[Flattening](./documentation/flattening.md)**: Flatten nested relationships into parent responses
- **[Field Aliases](./documentation/aliasing.md)**: Map external to internal field names
- **[Relation ID Mapping](./documentation/relation_id_mapping.md)**: Use custom fields for relationships
- **[Model Configuration](./documentation/model_configuration.md)**: Configure default behaviors per model
- **[Context Helpers](./documentation/context_helpers.md)**: Utilities for middleware and hooks
- **[Single Member Routes](./documentation/single_member_routes.md)**: Custom routes for single resources
- **[Single Related Models](./documentation/single_related_models.md)**: Access related resources directly

## License

MIT

## Repository

https://github.com/andrewsinnovations/apialize

---

## Complete Documentation Reference

### Core Operations
- [index.md](./documentation/index.md) - Overview and introduction
- [crud.md](./documentation/crud.md) - Complete CRUD operations (all endpoints at once)
- [list.md](./documentation/list.md) - List operation (GET collection)
- [single.md](./documentation/single.md) - Single record retrieval (GET by ID)
- [create.md](./documentation/create.md) - Create operation (POST)
- [update.md](./documentation/update.md) - Update operation (PUT - full replace)
- [patch.md](./documentation/patch.md) - Patch operation (PATCH - partial update)
- [destroy.md](./documentation/destroy.md) - Delete operation (DELETE)
- [search.md](./documentation/search.md) - Advanced search (POST with filters)

### Advanced Features
- [filtering.md](./documentation/filtering.md) - Query filtering and operators
- [hooks.md](./documentation/hooks.md) - Middleware and lifecycle hooks
- [aliasing.md](./documentation/aliasing.md) - Field name aliasing
- [flattening.md](./documentation/flattening.md) - Flatten nested relationships
- [relation_id_mapping.md](./documentation/relation_id_mapping.md) - Custom relationship identifiers
- [model_configuration.md](./documentation/model_configuration.md) - Per-model default configuration
- [context_helpers.md](./documentation/context_helpers.md) - Request context utilities
- [single_member_routes.md](./documentation/single_member_routes.md) - Custom single resource routes
- [single_related_models.md](./documentation/single_related_models.md) - Direct access to related resources
