# Apialize Documentation

Apialize is a library for quickly creating RESTful API endpoints with Sequelize models.

## Operations

Apialize provides the following operations for building your API:

| Operation | HTTP Method | Description |
|-----------|-------------|-------------|
| [list](list.md) | GET | Retrieve a collection of records with filtering, sorting, and pagination |
| [search](search.md) | POST | Search for records using a request body with advanced filtering options |
| [single](single.md) | GET | Retrieve a single record by ID |
| [create](create.md) | POST | Create a new record |
| [update](update.md) | PUT | Fully replace an existing record |
| [patch](patch.md) | PATCH | Partially update an existing record |
| [destroy](destroy.md) | DELETE | Delete a record |
| [crud](crud.md) | Multiple | Mount all CRUD operations at once |

## Guides

| Guide | Description |
|-------|-------------|
| [Model Configuration](model_configuration.md) | Configure apialize defaults and contexts directly in your models |
| [Field Aliasing](aliasing.md) | Map external API field names to internal database column names |
| [Context Helpers](context_helpers.md) | Helper functions for filtering, scoping, and modifying data in hooks |
| [Filtering](filtering.md) | Filter operators and syntax for list and search operations |
| [Flattening](flattening.md) | Flatten nested relationships into parent records |
| [Hooks](hooks.md) | Pre and post hooks for custom logic during operations |
| [Relation ID Mapping](relation_id_mapping.md) | Map external IDs for related models in filters and responses |
| [Single - Member Routes](single_member_routes.md) | Custom action routes on single resources |
| [Single - Related Models](single_related_models.md) | Nested CRUD endpoints for related models |

## Quick Start

```javascript
const express = require('express');
const { crud } = require('apialize');
const { Item } = require('./models');

const app = express();
app.use(express.json());

// Mount all CRUD routes for the Item model
app.use('/items', crud(Item));

app.listen(3000);
```

This creates the following endpoints:
- `GET /items` - List all items
- `POST /items/search` - Search items
- `GET /items/:id` - Get a single item
- `POST /items` - Create a new item
- `PUT /items/:id` - Update an item (full replacement)
- `PATCH /items/:id` - Patch an item (partial update)
- `DELETE /items/:id` - Delete an item

## Individual Operations

You can also mount operations individually:

```javascript
const { list, single, create, patch, destroy, search } = require('apialize');

// Only mount specific operations
app.use('/items', list(Item));
app.use('/items', single(Item));
app.use('/items', create(Item));
app.use('/items', patch(Item));
app.use('/items', destroy(Item));
app.use('/items', search(Item));
```

## Configuration

Each operation accepts configuration options:

```javascript
app.use('/items', list(Item, {
  // Operation-specific options
  allow_filtering_on: ['category', 'status'],
  allow_ordering_on: ['name', 'created_at']
}, {
  // Model options (shared configuration)
  include: [{ model: Category }]
}));
```

See individual operation documentation for available options.

## Model-Level Configuration

Instead of setting configuration options on each endpoint, you can define defaults directly on your Sequelize models. This allows you to centralize your API configuration and avoid repeating the same options across multiple endpoints.

Model-level configuration is set using the `apialize` option in your model definition:

```javascript
const Item = sequelize.define('Item', {
  // ... model attributes
}, {
  apialize: {
    default: {
      allow_filtering_on: ['category', 'status'],
      allow_ordering_on: ['name', 'created_at'],
      aliases: { externalName: 'internalColumn' }
    }
  }
});
```

Options set at the endpoint level will override model-level defaults. For more details and examples, see the [Model Configuration](model_configuration.md) guide.

## Default Configuration

The following are the default configuration values that apialize uses for each operation. Any options you pass will override these defaults.

| Option | list | search | single | create | update | patch | destroy |
|--------|------|--------|--------|--------|--------|-------|---------|
| `aliases` | `null` | `null` | `null` | `null` | `null` | `null` | - |
| `allow_bulk_create` | - | - | - | `false` | - | - | - |
| `allow_filtering` | `true` | - | - | - | - | - | - |
| `allow_filtering_on` | `null` | `null` | - | - | - | - | - |
| `allow_ordering` | `true` | - | - | - | - | - | - |
| `allow_ordering_on` | `null` | `null` | - | - | - | - | - |
| `allowed_fields` | - | - | - | `null` | `null` | `null` | - |
| `auto_relation_id_mapping` | `true` | `true` | `true` | `true` | `true` | `true` | - |
| `block_filtering_on` | `null` | `null` | - | - | - | - | - |
| `block_ordering_on` | `null` | `null` | - | - | - | - | - |
| `blocked_fields` | - | - | - | `null` | `null` | `null` | - |
| `default_order_by` | `'id'` | `'id'` | - | - | - | - | - |
| `default_order_dir` | `'ASC'` | `'ASC'` | - | - | - | - | - |
| `default_page_size` | `100` | `100` | - | - | - | - | - |
| `disable_subquery` | `true` | `true` | - | - | - | - | - |
| `flattening` | `null` | `null` | `null` | - | - | - | - |
| `id_mapping` | `'id'` | `'id'` | `'id'` | `'id'` | `'id'` | `'id'` | `'id'` |
| `member_routes` | - | - | `[]` | - | - | - | - |
| `meta_show_filters` | `false` | `false` | - | - | - | - | - |
| `meta_show_ordering` | `false` | `false` | - | - | - | - | - |
| `middleware` | `[]` | `[]` | `[]` | `[]` | `[]` | `[]` | `[]` |
| `param_name` | - | - | `'id'` | - | - | - | - |
| `path` | - | `'/search'` | - | - | - | - | - |
| `post` | `null` | `null` | `null` | `null` | `null` | `null` | `null` |
| `pre` | `null` | `null` | `null` | `null` | `null` | `null` | `null` |
| `related` | - | - | `[]` | - | - | - | - |
| `relation_id_mapping` | `null` | `null` | `null` | `null` | `null` | `null` | - |
| `validate` | - | - | - | `true` | `true` | `true` | - |
