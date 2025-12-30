# Single Operation - Member Routes

Member routes allow you to add custom action endpoints to a single resource. These routes are mounted under the resource's ID path and automatically load the record before calling your handler.

## Record Loading

**Important:** The record available in member routes is loaded using the same configuration as the parent `single()` call. This means:

- **Model Options** (`modelOptions`) - The third parameter to `single()` is used when loading the record. This includes `attributes`, `include`, `where`, and other Sequelize query options.
- **ID Mapping** (`id_mapping`) - The record is looked up using the parent's `id_mapping` configuration and normalized accordingly.
- **Middleware** - All middleware defined on the parent `single()` operation runs before the record is loaded and before your handler is called.

```javascript
app.use('/users', single(User, {
  id_mapping: 'external_id',
  middleware: [authMiddleware]
}, {
  attributes: ['id', 'external_id', 'name', 'email'],
  include: [{ model: Department, as: 'department' }]
}));
```

In this example, any member routes will:
1. Run `authMiddleware` first
2. Look up the user by `external_id` (from the URL parameter)
3. Load only the specified `attributes` and include the `department` association
4. Make this loaded record available in `req.apialize.record` and `req.apialize.rawRecord`

This ensures consistency between the main `GET /:id` endpoint and all member routes.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Configuration](#configuration)
- [Handler Function](#handler-function)
- [HTTP Methods](#http-methods)
- [Middleware](#middleware)
- [Context Access](#context-access)
- [Examples](#examples)

## Basic Usage

```javascript
const { single } = require('apialize');

app.use('/users', single(User, {
  member_routes: [
    {
      path: 'profile',
      method: 'get',
      async handler(req, res) {
        return { success: true, userName: req.apialize.record.name };
      }
    }
  ]
}));
```

This creates a `GET /users/:id/profile` endpoint that automatically loads the user record before calling your handler.

## Configuration

### Member Route Object

Each member route is configured as an object with the following properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `path` | `string` | Yes | The sub-path for the route (e.g., `'profile'` or `'/profile'`) |
| `method` | `string` | No | HTTP method: `'get'`, `'post'`, `'put'`, `'patch'`, `'delete'`. Default: `'get'` |
| `handler` | `Function` | Yes | Async function to handle the request |
| `middleware` | `Array<Function>` | No | Route-specific middleware |

### Path Configuration

The path can be specified with or without a leading slash:

```javascript
member_routes: [
  { path: 'profile', method: 'get', handler: ... },    // /users/:id/profile
  { path: '/stats', method: 'get', handler: ... },     // /users/:id/stats
  { path: 'settings/email', method: 'put', handler: ... }  // /users/:id/settings/email
]
```

## Handler Function

### Function Signature

```javascript
async handler(req, res, context)
```

| Parameter | Description |
|-----------|-------------|
| `req` | Express request object with apialize context |
| `res` | Express response object |
| `context` | The apialize context object (same as `req.apialize`) |

### Return Value Behavior

The handler can return data in several ways:

#### 1. Return a value (automatic JSON response)

```javascript
async handler(req, res) {
  return { success: true, data: 'some data' };
}
// Response: { "success": true, "data": "some data" }
```

#### 2. Return undefined (uses default single payload)

```javascript
async handler(req, res) {
  // Perform some action but don't return anything
  await req.apialize.rawRecord.update({ viewed_at: new Date() });
  // Response: { "success": true, "record": { ... } }
}
```

#### 3. Send response directly

```javascript
async handler(req, res) {
  res.status(202).json({ custom: true });
  // Response already sent, handler return value ignored
}
```

## HTTP Methods

Member routes support all standard HTTP methods:

```javascript
app.use('/users', single(User, {
  member_routes: [
    // GET request
    {
      path: 'profile',
      method: 'get',
      async handler(req) {
        return { name: req.apialize.record.name };
      }
    },
    
    // POST request
    {
      path: 'send-email',
      method: 'post',
      async handler(req) {
        await sendEmail(req.apialize.record.email, req.body.message);
        return { success: true, message: 'Email sent' };
      }
    },
    
    // PUT request
    {
      path: 'replace-settings',
      method: 'put',
      async handler(req) {
        const inst = req.apialize.rawRecord;
        await inst.update({ settings: req.body });
        return { success: true };
      }
    },
    
    // PATCH request
    {
      path: 'update-settings',
      method: 'patch',
      async handler(req) {
        const inst = req.apialize.rawRecord;
        await inst.update(req.body);
        return { success: true };
      }
    },
    
    // DELETE request
    {
      path: 'archive',
      method: 'delete',
      async handler(req) {
        await req.apialize.rawRecord.update({ archived: true });
        return { success: true, archived: true };
      }
    }
  ]
}));
```

## Middleware

### Single-Level Middleware

Middleware defined on the single operation applies to all member routes:

```javascript
const authMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use('/users', single(User, {
  middleware: [authMiddleware],  // Applies to all routes including member routes
  member_routes: [
    {
      path: 'profile',
      method: 'get',
      async handler(req) {
        return { user: req.apialize.record };
      }
    }
  ]
}));
```

### Route-Specific Middleware

Each member route can have its own middleware:

```javascript
const adminOnly = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const rateLimiter = (req, res, next) => {
  // Rate limiting logic
  next();
};

app.use('/users', single(User, {
  member_routes: [
    {
      path: 'admin-action',
      method: 'post',
      middleware: [adminOnly],  // Only this route requires admin
      async handler(req) {
        return { success: true };
      }
    },
    {
      path: 'expensive-operation',
      method: 'post',
      middleware: [rateLimiter],  // Rate limited route
      async handler(req) {
        return { result: await expensiveOperation() };
      }
    }
  ]
}));
```

### Middleware Execution Order

1. Single operation middleware (from `options.middleware`)
2. Record loading (automatic)
3. Route-specific middleware (from `member_routes[].middleware`)
4. Handler function

## Context Access

Member routes have full access to the apialize context:

### Available Context Properties

```javascript
async handler(req, res, context) {
  // req.apialize === context

  // The loaded record as a plain object (normalized with id_mapping)
  const record = req.apialize.record;
  
  // The raw Sequelize model instance (for updates/deletes)
  const instance = req.apialize.rawRecord;
  
  // The resource ID from the URL
  const id = req.apialize.id;
  
  // WHERE clause used to load the record
  const where = req.apialize.where;
  
  // Query options used
  const options = req.apialize.options;
  
  // Default response payload (can be modified or used)
  const payload = req.apialize.singlePayload;
  
  // Access to all Sequelize models (if available)
  const models = req.apialize.models;
}
```

### `record` vs `rawRecord`

| Property | Type | Description |
|----------|------|-------------|
| `record` | `Object` | Plain JavaScript object with ID normalized |
| `rawRecord` | `Sequelize Instance` | Original Sequelize model instance |

```javascript
async handler(req, res) {
  // Read data from normalized plain object
  console.log(req.apialize.record.name);
  
  // Use rawRecord for updates (Sequelize instance methods)
  await req.apialize.rawRecord.update({ name: 'New Name' });
  await req.apialize.rawRecord.destroy();
  
  // rawRecord has Sequelize methods like get(), save(), reload()
  const plainData = req.apialize.rawRecord.get({ plain: true });
}
```

## Examples

### Profile Endpoint

```javascript
app.use('/users', single(User, {
  member_routes: [
    {
      path: 'profile',
      method: 'get',
      async handler(req) {
        const user = req.apialize.record;
        return {
          success: true,
          profile: {
            id: user.id,
            name: user.name,
            avatar: user.avatar_url,
            memberSince: user.created_at
          }
        };
      }
    }
  ]
}));
```

### Touch/Ping Endpoint

```javascript
app.use('/users', single(User, {
  member_routes: [
    {
      path: 'touch',
      method: 'post',
      async handler(req) {
        const inst = req.apialize.rawRecord;
        await inst.update({ last_seen_at: new Date() });
        // Returns default single payload with updated record
      }
    }
  ]
}));
```

### Custom Status Code Response

```javascript
app.use('/users', single(User, {
  member_routes: [
    {
      path: 'deactivate',
      method: 'post',
      async handler(req, res) {
        await req.apialize.rawRecord.update({ active: false });
        res.status(202).json({ 
          success: true, 
          message: 'User deactivation scheduled' 
        });
      }
    }
  ]
}));
```

### Accessing Other Models

```javascript
app.use('/users', single(User, {
  member_routes: [
    {
      path: 'activity',
      method: 'get',
      async handler(req) {
        const userId = req.apialize.record.id;
        const { ActivityLog } = req.apialize.models;
        
        const activities = await ActivityLog.findAll({
          where: { user_id: userId },
          order: [['created_at', 'DESC']],
          limit: 10
        });
        
        return {
          success: true,
          activities: activities.map(a => a.get({ plain: true }))
        };
      }
    }
  ]
}));
```

### Delete with Confirmation

```javascript
app.use('/users', single(User, {
  member_routes: [
    {
      path: 'soft-delete',
      method: 'delete',
      async handler(req) {
        await req.apialize.rawRecord.update({ 
          deleted_at: new Date(),
          deleted_by: req.user.id 
        });
        return { success: true, deleted: true };
      }
    }
  ]
}));
```

### Statistics Endpoint

```javascript
app.use('/users', single(User, {
  member_routes: [
    {
      path: 'stats',
      method: 'get',
      async handler(req) {
        const userId = req.apialize.record.id;
        const { Post, Comment } = req.apialize.models;
        
        const [postCount, commentCount] = await Promise.all([
          Post.count({ where: { user_id: userId } }),
          Comment.count({ where: { user_id: userId } })
        ]);
        
        return {
          success: true,
          stats: {
            posts: postCount,
            comments: commentCount,
            total_activity: postCount + commentCount
          }
        };
      }
    }
  ]
}));
```

## Error Handling

### 404 When Record Not Found

If the parent record doesn't exist, a 404 is returned before the handler is called:

```javascript
// GET /users/999/profile where user 999 doesn't exist
// Response: 404 Not Found
```

### Custom Error Handling

```javascript
app.use('/users', single(User, {
  member_routes: [
    {
      path: 'risky-action',
      method: 'post',
      async handler(req, res) {
        try {
          await performRiskyAction(req.apialize.rawRecord);
          return { success: true };
        } catch (error) {
          res.status(400).json({ 
            success: false, 
            error: error.message 
          });
        }
      }
    }
  ]
}));
```

## Validation

Member route configuration is validated at startup:

- `handler` must be a function
- `path` must be a non-empty string
- `method` must be one of: `get`, `post`, `put`, `patch`, `delete`

Invalid configuration throws an error:

```javascript
// This will throw an error at startup
app.use('/users', single(User, {
  member_routes: [
    { path: '', method: 'get', handler: () => {} },  // Error: empty path
    { path: 'test', method: 'OPTIONS', handler: () => {} },  // Error: invalid method
    { path: 'test', method: 'get' }  // Error: missing handler
  ]
}));
```

## See Also

- [Single Operation](single.md) - Main single operation documentation
- [Related Models](single_related_models.md) - Nested CRUD endpoints
