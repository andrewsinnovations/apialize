# Hooks

Hooks (also called lifecycle callbacks) allow you to execute custom logic at specific points during an operation's lifecycle. Apialize provides `pre` and `post` hooks that run before and after the main database operation.

## Table of Contents

- [Overview](#overview)
- [Hook Types](#hook-types)
- [Context Object](#context-object)
- [Context Helpers](#context-helpers)
- [Supported Operations](#supported-operations)
- [Basic Usage](#basic-usage)
- [Multiple Hooks](#multiple-hooks)
- [Common Use Cases](#common-use-cases)
- [Transaction Handling](#transaction-handling)
- [Accessing Related Models](#accessing-related-models)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Overview

Hooks provide a way to:

- Execute custom logic before or after database operations
- Validate or transform data
- Perform side effects (logging, notifications, audit trails)
- Access and modify the response payload
- Work within database transactions (for write operations)
- Access related Sequelize models

## Hook Types

### Pre Hooks

Pre hooks run **before** the main database operation:

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    console.log('About to create record');
    // Return data to pass to post hooks
    return { startTime: Date.now() };
  }
}));
```

### Post Hooks

Post hooks run **after** the main database operation:

```javascript
app.use('/items', create(Item, {
  post: async (context) => {
    console.log('Record created:', context.created);
    // Access pre hook result
    const duration = Date.now() - context.preResult.startTime;
    // Modify response payload
    context.payload.duration = duration;
  }
}));
```

## Context Object

The context object provides access to the request, response, models, and operation-specific data. It also includes [context helpers](context_helpers.md) for common operations.

### Common Properties (All Operations)

| Property | Type | Description |
|----------|------|-------------|
| `context.model` | `Model` | The Sequelize model for the operation |
| `context.models` | `Object` | All Sequelize models keyed by name |
| `context.req` | `Request` | Express request object |
| `context.res` | `Response` | Express response object |
| `context.preResult` | `any` | Return value from the last pre hook (in post hooks) |
| `context.payload` | `Object` | Response payload (modifiable in post hooks) |
| `context.idMapping` | `string` | The ID mapping field name |
| `context.id_mapping` | `string` | Snake_case alias for `idMapping` |
| `context.modelOptions` | `Object` | The modelOptions passed to the operation |
| `context.model_options` | `Object` | Snake_case alias for `modelOptions` |

### Operation-Specific Properties

#### Create Operation

| Property | Type | Description |
|----------|------|-------------|
| `context.req.body` | `Object\|Array` | The request body |
| `context.transaction` | `Transaction` | Sequelize transaction (in pre/post hooks) |
| `context.created` | `Model\|Array` | Created record(s) (in post hooks only) |

#### Update/Patch Operations

| Property | Type | Description |
|----------|------|-------------|
| `context.req.params.id` | `string` | The record ID from the URL |
| `context.req.body` | `Object` | The request body |
| `context.transaction` | `Transaction` | Sequelize transaction |

#### Destroy Operation

| Property | Type | Description |
|----------|------|-------------|
| `context.id` | `string` | The record ID from the URL |
| `context.where` | `Object` | The WHERE clause for deletion |
| `context.transaction` | `Transaction` | Sequelize transaction |

#### List/Search Operations

| Property | Type | Description |
|----------|------|-------------|
| `context.payload.data` | `Array` | Retrieved records (in post hooks only) |
| `context.payload.meta` | `Object` | Response metadata including paging info (in post hooks) |

#### Single Operation

| Property | Type | Description |
|----------|------|-------------|
| `context.req.params.id` | `string` | The record ID from the URL |
| `context.record` | `Model` | The fetched record (in post hooks only) |
| `context.transaction` | `undefined` | Read-only operation, no transaction |

## Context Helpers

The context object includes helper functions for common operations. See [Context Helpers](context_helpers.md) for complete documentation.

### Query Helpers

| Helper | Description |
|--------|-------------|
| `apply_where(conditions)` | Add WHERE conditions to the query |
| `apply_multiple_where(array)` | Apply multiple WHERE conditions at once |
| `apply_where_if_not_exists(conditions)` | Add WHERE conditions only if they don't exist |
| `remove_where(keys)` | Remove conditions from WHERE clause |
| `replace_where(newWhere)` | Replace entire WHERE clause |
| `apply_scope(name, ...args)` | Apply a Sequelize scope |
| `apply_scopes(array)` | Apply multiple scopes at once |

### Body Helpers (create/update/patch only)

| Helper | Description |
|--------|-------------|
| `set_value(key, value)` | Set a single value in the request body |
| `set_multiple_values(values)` | Set multiple values at once |
| `remove_value(keys)` | Remove values from the request body |
| `replace_body(newBody)` | Replace entire request body |

### Operation Control

| Helper | Description |
|--------|-------------|
| `cancel_operation(status, response)` | Cancel operation and return custom response |

**Example:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Apply tenant filter
    context.apply_where({ tenant_id: context.req.user.tenantId });
    
    // Auto-populate fields
    context.set_value('created_by', context.req.user.id);
    
    // Validation
    if (context.req.body.price < 0) {
      context.cancel_operation(400, { 
        success: false, 
        error: 'Price cannot be negative' 
      });
      return;
    }
  }
}));
```

## Supported Operations

Hooks are available in all apialize operations:

| Operation | Pre Hook | Post Hook | Has Transaction |
|-----------|----------|-----------|-----------------|
| [create](create.md) | ✓ | ✓ | ✓ |
| [update](update.md) | ✓ | ✓ | ✓ |
| [patch](patch.md) | ✓ | ✓ | ✓ |
| [destroy](destroy.md) | ✓ | ✓ | ✓ |
| [list](list.md) | ✓ | ✓ | ✗ |
| [search](search.md) | ✓ | ✓ | ✗ |
| [single](single.md) | ✓ | ✓ | ✗ |

## Basic Usage

### Pre Hook

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    console.log('Creating item with body:', context.req.body);
    console.log('Request user:', context.req.user);
    
    // Return data to pass to post hooks
    return { startTime: Date.now() };
  }
}));
```

### Post Hook

```javascript
app.use('/items', create(Item, {
  post: async (context) => {
    // Access the created record
    console.log('Created:', context.created.id);
    
    // Access pre hook result
    console.log('Started at:', context.preResult.startTime);
    
    // Modify the response payload
    context.payload.createdAt = new Date().toISOString();
  }
}));
```

### Both Hooks Together

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    return { startTime: Date.now() };
  },
  post: async (context) => {
    const duration = Date.now() - context.preResult.startTime;
    context.payload.duration = `${duration}ms`;
  }
}));
```

## Multiple Hooks

Both `pre` and `post` accept arrays of functions that execute in order:

```javascript
app.use('/items', create(Item, {
  pre: [
    async (context) => {
      console.log('Pre hook 1');
      return { step: 1 };
    },
    async (context) => {
      console.log('Pre hook 2');
      // This return value becomes context.preResult
      return { step: 2, finalPre: true };
    }
  ],
  post: [
    async (context) => {
      console.log('Post hook 1');
      context.payload.hook1 = true;
    },
    async (context) => {
      console.log('Post hook 2');
      context.payload.hook2 = true;
    }
  ]
}));
```

**Important:** Only the return value of the **last** pre hook is available in `context.preResult`.

## Common Use Cases

### 1. Logging and Timing

```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    return { startTime: Date.now() };
  },
  post: async (context) => {
    const duration = Date.now() - context.preResult.startTime;
    console.log(`List operation took ${duration}ms`);
  }
}));
```

### 2. Audit Trail

```javascript
app.use('/items', create(Item, {
  post: async (context) => {
    await AuditLog.create({
      action: 'CREATE',
      model: 'Item',
      recordId: context.created.id,
      userId: context.req.user?.id,
      timestamp: new Date()
    }, { transaction: context.transaction });
  }
}));
```

### 3. Automatic Field Population

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Add created_by from authenticated user using set_value helper
    context.set_value('created_by', context.req.user?.id);
  }
}));
```

### 4. Side Effects (Notifications)

```javascript
app.use('/orders', create(Order, {
  post: async (context) => {
    // Send notification after order is created
    await sendOrderConfirmation(context.created);
  }
}));
```

### 5. Cascading Operations

```javascript
app.use('/users', create(User, {
  post: async (context) => {
    // Create default profile for new user
    await context.models.UserProfile.create({
      user_id: context.created.id,
      settings: { theme: 'default' }
    }, { transaction: context.transaction });
  }
}));
```

### 6. Response Enrichment

```javascript
app.use('/items', single(Item, {
  post: async (context) => {
    // Add computed fields to response
    context.payload.record.isExpensive = context.record.price > 1000;
    context.payload.meta = { fetchedAt: new Date() };
  }
}));
```

### 7. Validation

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    if (context.req.body.price < 0) {
      // Use cancel_operation helper to stop execution and return error
      context.cancel_operation(400, {
        success: false,
        error: 'Price cannot be negative'
      });
      return;
    }
  }
}));
```

### 8. Cleanup on Delete

```javascript
app.use('/items', destroy(Item, {
  post: async (context) => {
    // Clean up related files
    await deleteItemFiles(context.id);
    // Log deletion
    console.log(`Deleted item ${context.id}`);
  }
}));
```

## Transaction Handling

Write operations (create, update, patch, destroy) run within a database transaction. Hooks have access to this transaction via `context.transaction`.

### Using the Transaction

```javascript
app.use('/items', create(Item, {
  post: async (context) => {
    // Create related record in same transaction
    await RelatedModel.create({
      item_id: context.created.id,
      type: 'auto-created'
    }, { transaction: context.transaction });
    
    // If this fails, the main create also rolls back
  }
}));
```

### Transaction Behavior

- Pre hooks run **after** transaction begins
- Post hooks run **before** transaction commits
- If any hook throws an error, the transaction rolls back
- If you need to commit early, consider using middleware instead

## Accessing Related Models

Use `context.models` to access all Sequelize models in hooks:

```javascript
app.use('/users', create(User, {
  post: async (context) => {
    const userId = context.created.id;
    
    // Access related models
    await context.models.Post.create({
      title: 'Welcome Post',
      user_id: userId
    }, { transaction: context.transaction });
    
    await context.models.UserSettings.create({
      user_id: userId,
      notifications: true
    }, { transaction: context.transaction });
  }
}));
```

## Error Handling

### Throwing Errors

Throwing an error in a hook will abort the operation and roll back any transaction:

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    const count = await Item.count({ where: { category: context.req.body.category } });
    if (count >= 100) {
      throw new Error('Category limit reached');
    }
  }
}));
```

### Sending Custom Error Responses

Use `cancel_operation` helper to send a custom error response and stop execution:

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    if (!isValidCategory(context.req.body.category)) {
      context.cancel_operation(400, {
        success: false,
        error: 'Invalid category'
      });
      return;
    }
  }
}));
```

### Graceful Error Handling

```javascript
app.use('/items', create(Item, {
  post: async (context) => {
    try {
      await sendNotification(context.created);
    } catch (error) {
      // Log error but don't fail the request
      console.error('Notification failed:', error);
      // Optionally add warning to response
      context.payload.warning = 'Notification could not be sent';
    }
  }
}));
```

## Best Practices

### 1. Keep Hooks Focused

Each hook should have a single responsibility:

```javascript
// Good: Separate concerns
app.use('/items', create(Item, {
  post: [
    async (context) => logCreation(context),
    async (context) => sendNotification(context),
    async (context) => updateMetrics(context)
  ]
}));

// Avoid: One hook doing too much
app.use('/items', create(Item, {
  post: async (context) => {
    // Too many responsibilities in one hook
  }
}));
```

### 2. Handle Errors Appropriately

Decide whether errors should abort the operation or just be logged:

```javascript
app.use('/items', create(Item, {
  post: async (context) => {
    // Critical: Should abort if fails
    await createRequiredRelation(context);
    
    // Non-critical: Log and continue
    try {
      await sendOptionalNotification(context);
    } catch (e) {
      console.error('Non-critical error:', e);
    }
  }
}));
```

### 3. Use Transactions for Related Operations

Always use the provided transaction for related database operations:

```javascript
// Good: Uses transaction
await RelatedModel.create(data, { transaction: context.transaction });

// Bad: Creates outside transaction
await RelatedModel.create(data); // Won't roll back if main op fails
```

### 4. Use cancel_operation for Validation Errors

Use the `cancel_operation` helper to send error responses and stop execution:

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    if (invalid) {
      context.cancel_operation(400, { error: 'Invalid' });
      return;
    }
    // Continue with operation...
  }
}));
```

### 5. Use Pre Hooks for Validation, Post Hooks for Side Effects

```javascript
app.use('/items', create(Item, {
  // Validation in pre hook
  pre: async (context) => {
    if (!isValid(context.req.body)) {
      context.cancel_operation(400, { error: 'Validation failed' });
      return;
    }
  },
  // Side effects in post hook
  post: async (context) => {
    await sendNotification(context.created);
    await updateCache(context.created);
  }
}));
```

### 6. Document Your Hooks

Add comments explaining what each hook does:

```javascript
app.use('/orders', create(Order, {
  pre: async (context) => {
    // Validate inventory availability before creating order
    await validateInventory(context.req.body.items);
  },
  post: async (context) => {
    // Reserve inventory items after order is created
    await reserveInventory(context.created.id, context.req.body.items);
    // Send confirmation email to customer
    await sendOrderConfirmation(context.created);
  }
}));
```

## Hooks vs Middleware

| Feature | Hooks | Middleware |
|---------|-------|------------|
| Timing | Before/after DB operation | Before route handler |
| Transaction access | Yes (write ops) | No |
| Access to created/updated record | Yes (post hooks) | No |
| Can modify response payload | Yes | Indirectly |
| Can short-circuit request | Yes | Yes |
| Best for | DB-related logic, side effects | Auth, request transformation |

Use **middleware** for:
- Authentication/authorization
- Request validation
- Adding filters/scopes
- Setting default values via `req.apialize`

Use **hooks** for:
- Audit logging
- Related record creation
- Post-operation notifications
- Response enrichment
- Transaction-dependent operations
