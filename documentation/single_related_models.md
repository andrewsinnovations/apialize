# Single Operation - Related Models

The `related` option allows you to create nested CRUD endpoints for associated models under a single resource. This is useful for parent-child relationships where you want to access child records in the context of their parent.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Configuration](#configuration)
- [Operations](#operations)
- [Path Generation](#path-generation)
- [Foreign Key Configuration](#foreign-key-configuration)
- [Per-Operation Configuration](#per-operation-configuration)
- [Nested Related Models](#nested-related-models)
- [Examples](#examples)

## Basic Usage

```javascript
const { single, create } = require('apialize');

// Define associations in your models
User.hasMany(Post, { foreignKey: 'user_id' });
Post.belongsTo(User, { foreignKey: 'user_id' });

// Setup endpoints
app.use('/users', create(User));
app.use('/users', single(User, {
  related: [
    { model: Post, operations: ['list', 'get'] }
  ]
}));
```

This creates the following endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/users/:id` | Get single user |
| `GET` | `/users/:id/posts` | List user's posts |
| `GET` | `/users/:id/posts/:postId` | Get single post belonging to user |

## Configuration

### Related Model Object

Each related model is configured as an object with the following properties:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `model` | `Model` | Yes | - | The Sequelize model for the related resource |
| `operations` | `Array<string>` | No | `['list', 'get']` | Which CRUD operations to enable |
| `path` | `string` | No | Auto-generated | Custom URL path for the related endpoint |
| `foreignKey` | `string` | No | Auto-detected | Foreign key column name |
| `options` | `Object` | No | `{}` | Options passed to each operation (like list, search, etc.) |
| `perOperation` | `Object` | No | `{}` | Per-operation configuration overrides |
| `param_name` | `string` | No | Auto-generated | URL parameter name for related resource ID |
| `id_mapping` | `string` | No | `'id'` | ID field mapping for the related model |
| `through` | `Model` | No | - | Through model for many-to-many relationships |
| `as` | `string` | No | - | Association alias for many-to-many through table |
| `related` | `Array` | No | `[]` | Nested related models (recursive) |

### Operations Array

The `operations` array accepts the following values:

| Operation | HTTP Method | Path | Description |
|-----------|-------------|------|-------------|
| `'list'` | GET | `/:parentId/{path}` | List all related records |
| `'search'` | POST | `/:parentId/{path}/search` | Search related records |
| `'get'` | GET | `/:parentId/{path}/:childId` | Get single related record |
| `'post'` / `'create'` | POST | `/:parentId/{path}` | Create related record |
| `'put'` / `'update'` | PUT | `/:parentId/{path}/:childId` | Full update related record |
| `'patch'` | PATCH | `/:parentId/{path}/:childId` | Partial update related record |
| `'delete'` / `'destroy'` | DELETE | `/:parentId/{path}/:childId` | Delete related record |

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    operations: ['list', 'search', 'get', 'post', 'put', 'patch', 'delete']
  }]
}));
```

## Path Generation

### Automatic Path Generation

By default, paths are automatically generated from the model name:

1. Convert PascalCase to snake_case
2. Pluralize the result

| Model Name | Generated Path |
|------------|----------------|
| `Post` | `/posts` |
| `Comment` | `/comments` |
| `UserProfile` | `/user_profiles` |
| `RelatedThing` | `/related_things` |
| `Category` | `/categories` |
| `Company` | `/companies` |

### Custom Path

Override the automatic path with the `path` property:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    path: 'articles',  // Use /articles instead of /posts
    operations: ['list', 'get']
  }]
}));

// Creates: GET /users/:id/articles
```

## Foreign Key Configuration

### Automatic Detection

By default, the foreign key is derived from the parent model name:

```javascript
// Parent model: User
// Default foreign key: user_id

app.use('/users', single(User, {
  related: [{ model: Post }]
}));
// Posts will be filtered by: WHERE user_id = :parentId
```

### Custom Foreign Key

Specify a custom foreign key:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    foreignKey: 'author_id',  // Use author_id instead of user_id
    operations: ['list', 'get']
  }]
}));
```

### Many-to-Many Relationships

For many-to-many relationships with a through (junction) table:

```javascript
// Models
User.belongsToMany(Tag, { through: UserTag, foreignKey: 'user_id' });
Tag.belongsToMany(User, { through: UserTag, foreignKey: 'tag_id' });

app.use('/users', single(User, {
  related: [{
    model: Tag,
    through: UserTag,      // The junction table model
    foreignKey: 'user_id', // FK in junction table pointing to parent
    as: 'Tags',            // Association alias (optional)
    operations: ['list', 'get']
  }]
}));
```

## Per-Operation Configuration

### Global Related Options

Options passed to `options` apply to all operations:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    options: {
      default_page_size: 10,
      default_order_by: 'created_at',
      default_order_dir: 'DESC',
      middleware: [authMiddleware]
    },
    operations: ['list', 'get', 'post']
  }]
}));
```

### Per-Operation Overrides

Use `perOperation` to configure specific operations differently:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    options: {
      default_page_size: 10  // Applies to list and search
    },
    perOperation: {
      list: {
        allow_filtering_on: ['status', 'category']
      },
      get: {
        modelOptions: {
          include: [{ model: Comment, as: 'comments' }]
        }
      },
      post: {
        allowed_fields: ['title', 'content'],
        blocked_fields: ['user_id']  // Set automatically
      },
      patch: {
        allowed_fields: ['title', 'content', 'status']
      },
      delete: {
        middleware: [adminOnlyMiddleware]
      }
    },
    operations: ['list', 'get', 'post', 'patch', 'delete']
  }]
}));
```

### Operation-Specific Model Options

```javascript
perOperation: {
  list: {
    modelOptions: {
      attributes: ['id', 'title', 'status', 'created_at']
    }
  },
  get: {
    modelOptions: {
      attributes: ['id', 'title', 'content', 'status', 'created_at'],
      include: [{ model: Tag, as: 'tags' }]
    }
  }
}
```

## Bulk Delete

Enable bulk delete on related endpoints:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    perOperation: {
      delete: {
        allow_bulk_delete: true
      }
    },
    operations: ['list', 'delete']
  }]
}));

// DELETE /users/1/posts
// Without ?confirm=true: Returns { success: true, confirm_required: true, ids: [1, 2, 3] }
// With ?confirm=true: Deletes all posts and returns { success: true, deleted: 3, ids: [1, 2, 3] }
```

## Nested Related Models

Related models can have their own related models, creating deeply nested endpoints:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    operations: ['list', 'get'],
    related: [{  // Nested under posts
      model: Comment,
      operations: ['list', 'get', 'post']
    }]
  }]
}));

// Creates:
// GET  /users/:userId/posts
// GET  /users/:userId/posts/:postId
// GET  /users/:userId/posts/:postId/comments
// GET  /users/:userId/posts/:postId/comments/:commentId
// POST /users/:userId/posts/:postId/comments
```

### Three-Level Nesting Example

```javascript
app.use('/organizations', single(Organization, {
  related: [{
    model: Team,
    operations: ['list', 'get'],
    related: [{
      model: User,
      operations: ['list', 'get'],
      related: [{
        model: Task,
        operations: ['list', 'get', 'post']
      }]
    }]
  }]
}));

// GET /organizations/:orgId/teams/:teamId/users/:userId/tasks
```

## Parent ID Mapping

When the parent model uses a custom `id_mapping`, related endpoints automatically resolve the internal ID:

```javascript
app.use('/users', single(User, {
  id_mapping: 'external_id',  // User uses UUID
  related: [{
    model: Post,
    operations: ['list', 'get', 'post']
  }]
}));

// GET /users/uuid-abc-123/posts
// Internally: Find user where external_id = 'uuid-abc-123', then filter posts by user.id
```

## Automatic Foreign Key Setting

For create/update operations, the foreign key is automatically set to the parent's ID:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    operations: ['post']  // Create posts under user
  }]
}));

// POST /users/5/posts
// Body: { "title": "My Post", "content": "..." }
// Result: Creates post with user_id = 5 automatically
```

You don't need to (and shouldn't) include the foreign key in the request body.

## Related Model ID Mapping

Configure custom ID mapping for the related model:

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    id_mapping: 'external_id',  // Posts use external_id
    operations: ['list', 'get']
  }]
}));

// GET /users/1/posts/post-uuid-123
// Looks up post by external_id instead of id
```

### Custom Parameter Name

```javascript
app.use('/users', single(User, {
  related: [{
    model: Post,
    param_name: 'article_id',  // Custom param name in URL
    operations: ['get']
  }]
}));

// Route becomes: GET /users/:id/posts/:article_id
```

## Examples

### Complete Blog API

```javascript
// Models
User.hasMany(Post, { foreignKey: 'author_id' });
Post.belongsTo(User, { foreignKey: 'author_id' });
Post.hasMany(Comment, { foreignKey: 'post_id' });
Comment.belongsTo(Post, { foreignKey: 'post_id' });

// Endpoints
app.use('/users', create(User));
app.use('/users', single(User, {
  related: [{
    model: Post,
    foreignKey: 'author_id',
    options: {
      default_order_by: 'created_at',
      default_order_dir: 'DESC'
    },
    operations: ['list', 'search', 'get', 'post', 'patch', 'delete'],
    related: [{
      model: Comment,
      options: {
        default_page_size: 20
      },
      operations: ['list', 'get', 'post', 'delete']
    }]
  }]
}));

// Available endpoints:
// GET    /users/:id
// GET    /users/:id/posts
// POST   /users/:id/posts/search
// GET    /users/:id/posts/:postId
// POST   /users/:id/posts
// PATCH  /users/:id/posts/:postId
// DELETE /users/:id/posts/:postId
// GET    /users/:id/posts/:postId/comments
// GET    /users/:id/posts/:postId/comments/:commentId
// POST   /users/:id/posts/:postId/comments
// DELETE /users/:id/posts/:postId/comments/:commentId
```

### E-Commerce Orders

```javascript
app.use('/customers', single(Customer, {
  related: [{
    model: Order,
    options: {
      default_order_by: 'created_at',
      default_order_dir: 'DESC'
    },
    perOperation: {
      list: {
        allow_filtering_on: ['status', 'created_at']
      },
      post: {
        blocked_fields: ['customer_id', 'total', 'status']
      }
    },
    operations: ['list', 'search', 'get', 'post'],
    related: [{
      model: OrderItem,
      operations: ['list', 'get']
    }]
  }]
}));
```

### Multi-Tenant Application

```javascript
const tenantMiddleware = (req, res, next) => {
  req.apialize.apply_where({ tenant_id: req.tenant.id });
  next();
};

app.use('/projects', single(Project, {
  middleware: [tenantMiddleware],
  related: [{
    model: Task,
    options: {
      middleware: [tenantMiddleware]  // Also scope tasks to tenant
    },
    perOperation: {
      post: {
        pre: async (context) => {
          // Auto-set tenant_id on create
          context.req.apialize.values.tenant_id = context.req.tenant.id;
        }
      }
    },
    operations: ['list', 'get', 'post', 'patch', 'delete']
  }]
}));
```

### Read-Only Related Endpoint

```javascript
app.use('/users', single(User, {
  related: [{
    model: AuditLog,
    path: 'activity',
    options: {
      default_page_size: 50,
      default_order_by: 'created_at',
      default_order_dir: 'DESC',
      allow_filtering_on: ['action_type', 'created_at']
    },
    operations: ['list']  // Read-only, no modifications allowed
  }]
}));
```

### Multiple Related Models

```javascript
app.use('/users', single(User, {
  related: [
    {
      model: Post,
      operations: ['list', 'get', 'post']
    },
    {
      model: Comment,
      operations: ['list', 'get']
    },
    {
      model: Notification,
      path: 'notifications',
      operations: ['list'],
      options: {
        default_page_size: 20
      }
    },
    {
      model: Setting,
      path: 'settings',
      operations: ['get', 'patch']  // Single settings object
    }
  ]
}));

// GET /users/:id/posts
// GET /users/:id/comments
// GET /users/:id/notifications
// GET /users/:id/settings/:settingId
// PATCH /users/:id/settings/:settingId
```

## Ownership Validation

Related endpoints automatically validate that child records belong to the parent:

```javascript
// GET /users/1/posts/5
// - First verifies user 1 exists
// - Then verifies post 5 has user_id = 1
// - Returns 404 if either check fails
```

This prevents accessing records that don't belong to the specified parent:

```javascript
// User 1 has posts [1, 2, 3]
// User 2 has posts [4, 5, 6]

// GET /users/1/posts/4 → 404 (post 4 belongs to user 2)
// GET /users/1/posts/1 → 200 (correct ownership)
```

## Error Handling

| Status Code | Condition |
|-------------|-----------|
| `200 OK` | Successful operation |
| `201 Created` | Successful creation |
| `404 Not Found` | Parent or child record not found |
| `400 Bad Request` | Invalid request body or parameters |
| `500 Internal Server Error` | Database or server error |

## See Also

- [Single Operation](single.md) - Main single operation documentation
- [Member Routes](single_member_routes.md) - Custom action endpoints
- [List Operation](list.md) - List operation options
- [Search Operation](search.md) - Search operation options
- [Create Operation](create.md) - Create operation options
