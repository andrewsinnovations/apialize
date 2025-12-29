# Context Helpers

Context helpers are utility functions available in pre and post [hooks](hooks.md) that simplify common operations like filtering, scoping, and modifying request data. These helpers are attached directly to the context object passed to hook functions.

## Quick Reference

| Helper | Description |
|--------|-------------|
| [`apply_where`](#apply_where) | Add WHERE conditions to the query (merges with existing) |
| [`apply_multiple_where`](#apply_multiple_where) | Apply multiple WHERE conditions from an array |
| [`apply_where_if_not_exists`](#apply_where_if_not_exists) | Add WHERE conditions only if the key doesn't already exist |
| [`remove_where`](#remove_where) | Remove specific keys from the WHERE clause |
| [`replace_where`](#replace_where) | Completely replace the WHERE clause |
| [`apply_scope`](#apply_scope) | Apply a single Sequelize scope to the query |
| [`apply_scopes`](#apply_scopes) | Apply multiple Sequelize scopes at once |
| [`set_value`](#set_value) | Set a single value in the request body |
| [`set_multiple_values`](#set_multiple_values) | Set multiple values in the request body |
| [`remove_value`](#remove_value) | Remove fields from the request body |
| [`replace_body`](#replace_body) | Completely replace the request body |
| [`cancel_operation`](#cancel_operation) | Cancel the operation and return a custom response |
| [`models`](#models) | Access all Sequelize models in the connection |

## Overview

All helpers use snake_case naming and are available on the `context` object:

```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    // Helpers available directly on context
    context.apply_where({ tenant_id: 1 });
    context.apply_scope('activeOnly');
  }
}));
```

## Query Helpers

These helpers modify the Sequelize query options, affecting which records are retrieved or modified.

### apply_where

Adds WHERE conditions to the query. Multiple calls merge conditions; duplicate keys are overwritten.

**Signature:** `context.apply_where(whereConditions)`

**Parameters:**
- `whereConditions` (Object) - Sequelize WHERE clause conditions

**Returns:** The current WHERE clause object

**Example:**
```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    // Simple equality
    context.apply_where({ status: 'active' });
    
    // Multiple conditions
    context.apply_where({ tenant_id: 1, category: 'electronics' });
    
    // Sequelize operators
    const { Op } = require('sequelize');
    context.apply_where({ price: { [Op.gte]: 100 } });
  }
}));
```

**Merging Behavior:**
```javascript
pre: async (context) => {
  context.apply_where({ tenant_id: 1 });
  context.apply_where({ status: 'active' });
  // Result: WHERE tenant_id = 1 AND status = 'active'
  
  context.apply_where({ status: 'inactive' });
  // Result: WHERE tenant_id = 1 AND status = 'inactive' (status overwritten)
}
```

---

### apply_multiple_where

Applies multiple WHERE conditions from an array in a single call.

**Signature:** `context.apply_multiple_where(conditionsArray)`

**Parameters:**
- `conditionsArray` (Array) - Array of WHERE condition objects

**Returns:** The current WHERE clause object

**Example:**
```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    const { Op } = require('sequelize');
    
    context.apply_multiple_where([
      { tenant_id: 1 },
      { status: 'active' },
      { price: { [Op.gte]: 50 } }
    ]);
    // Result: WHERE tenant_id = 1 AND status = 'active' AND price >= 50
  }
}));
```

---

### apply_where_if_not_exists

Adds WHERE conditions only if they don't already exist. Useful for setting default filters that can be overridden.

**Signature:** `context.apply_where_if_not_exists(whereConditions)`

**Parameters:**
- `whereConditions` (Object) - Sequelize WHERE clause conditions

**Returns:** The current WHERE clause object

**Example:**
```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    // This will be applied
    context.apply_where({ tenant_id: 1 });
    
    // This will NOT be applied (tenant_id already exists)
    context.apply_where_if_not_exists({ tenant_id: 2 });
    
    // This WILL be applied (status doesn't exist)
    context.apply_where_if_not_exists({ status: 'active' });
    
    // Result: WHERE tenant_id = 1 AND status = 'active'
  }
}));
```

**Use Case - Default Filters:**
```javascript
// Middleware sets a default that hooks can override
const defaultStatusMiddleware = (req, res, next) => {
  req.apialize.apply_where_if_not_exists({ status: 'active' });
  next();
};

app.use('/items', list(Item, {
  middleware: [defaultStatusMiddleware],
  pre: async (context) => {
    // Can override the default if needed
    context.apply_where({ status: 'pending' });
  }
}));
```

---

### remove_where

Removes one or more conditions from the WHERE clause.

**Signature:** `context.remove_where(keys)`

**Parameters:**
- `keys` (string | string[]) - Key(s) to remove from WHERE clause

**Returns:** The current WHERE clause object

**Example:**
```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    context.apply_where({ 
      tenant_id: 1, 
      status: 'active', 
      category: 'electronics' 
    });
    
    // Remove single key
    context.remove_where('category');
    // Result: WHERE tenant_id = 1 AND status = 'active'
    
    // Remove multiple keys
    context.remove_where(['tenant_id', 'status']);
    // Result: WHERE (empty)
  }
}));
```

---

### replace_where

Completely replaces the WHERE clause with new conditions.

**Signature:** `context.replace_where(newWhere)`

**Parameters:**
- `newWhere` (Object | null) - New WHERE clause (null or empty object clears all conditions)

**Returns:** The new WHERE clause object

**Example:**
```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    context.apply_where({ tenant_id: 1, status: 'active' });
    
    // Completely replace the WHERE clause
    context.replace_where({ category: 'books' });
    // Result: WHERE category = 'books' (previous conditions removed)
    
    // Clear all WHERE conditions
    context.replace_where({});
    // Result: no WHERE clause
  }
}));
```

---

## Scope Helpers

These helpers apply Sequelize model scopes to the query.

### apply_scope

Applies a single Sequelize scope to the query.

**Signature:** `context.apply_scope(scopeName, ...args)`

**Parameters:**
- `scopeName` (string | function) - Name of the scope or scope function
- `...args` (any) - Arguments to pass to parameterized scopes

**Returns:** The scoped model

**Example:**
```javascript
// Define scopes on your model
Item.addScope('byTenant', (tenantId) => ({
  where: { tenant_id: tenantId }
}));

Item.addScope('activeOnly', {
  where: { status: 'active' }
});

Item.addScope('expensive', {
  where: { price: { [Op.gte]: 1000 } }
});

// Use scopes in hooks
app.use('/items', list(Item, {
  pre: async (context) => {
    // Simple scope (no arguments)
    context.apply_scope('activeOnly');
    
    // Parameterized scope
    context.apply_scope('byTenant', context.req.user.tenantId);
  }
}));
```

---

### apply_scopes

Applies multiple scopes at once.

**Signature:** `context.apply_scopes(scopes)`

**Parameters:**
- `scopes` (Array) - Array of scope configurations. Each can be:
  - A string (scope name)
  - A function (scope function)
  - An object with `name` and optional `args` array

**Returns:** void

**Example:**
```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    context.apply_scopes([
      // String scope
      'activeOnly',
      
      // Parameterized scope with object syntax
      { name: 'byTenant', args: [context.req.user.tenantId] },
      
      // Another string scope
      'expensive'
    ]);
  }
}));
```

---

## Body Helpers

These helpers modify the request body for create, update, and patch operations.

### set_value

Sets a single value in the request body.

**Signature:** `context.set_value(key, value)`

**Parameters:**
- `key` (string) - The field name to set
- `value` (any) - The value to set

**Returns:** The current body values object

**Example:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Auto-populate fields
    context.set_value('created_by', context.req.user.id);
    context.set_value('status', 'pending');
    context.set_value('tenant_id', context.req.user.tenantId);
  }
}));
```

**Overriding User Input:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Force specific values regardless of what user sent
    context.set_value('status', 'pending'); // Always starts as pending
    context.set_value('approved', false);   // Cannot create as approved
  }
}));
```

---

### set_multiple_values

Sets multiple values at once using either an object or array of key-value pairs.

**Signature:** `context.set_multiple_values(values)`

**Parameters:**
- `values` (Object | Array) - Either:
  - An object with key-value pairs: `{ key1: value1, key2: value2 }`
  - An array of `[key, value]` tuples: `[['key1', value1], ['key2', value2]]`

**Returns:** The current body values object

**Example with Object:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    context.set_multiple_values({
      tenant_id: context.req.user.tenantId,
      created_by: context.req.user.id,
      status: 'active',
      priority: 1
    });
  }
}));
```

**Example with Array:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    const defaults = [
      ['tenant_id', context.req.user.tenantId],
      ['created_by', context.req.user.id],
      ['status', 'active']
    ];
    context.set_multiple_values(defaults);
  }
}));
```

---

### remove_value

Removes one or more values from the request body.

**Signature:** `context.remove_value(keys)`

**Parameters:**
- `keys` (string | string[]) - Key(s) to remove from the body

**Returns:** The current body values object

**Example:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Remove sensitive fields that shouldn't be set by users
    context.remove_value('admin_only_field');
    
    // Remove multiple fields
    context.remove_value(['internal_id', 'system_status', 'created_at']);
  }
}));
```

**Use Case - Sanitizing Input:**
```javascript
app.use('/users', create(User, {
  pre: async (context) => {
    // Prevent users from setting privileged fields
    context.remove_value(['role', 'permissions', 'is_admin']);
  }
}));
```

---

### replace_body

Completely replaces the request body with new values.

**Signature:** `context.replace_body(newBody)`

**Parameters:**
- `newBody` (Object | null) - The new body values (null or undefined creates empty object)

**Returns:** The new body values object

**Example:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Ignore user input entirely and construct body from scratch
    context.replace_body({
      name: context.req.body.name, // Only keep name from user
      tenant_id: context.req.user.tenantId,
      created_by: context.req.user.id,
      status: 'pending'
    });
  }
}));
```

**Use Case - Whitelist Approach:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    const userInput = context.req.body;
    
    // Only allow specific fields
    context.replace_body({
      name: userInput.name,
      description: userInput.description,
      price: userInput.price
    });
    
    // Then add system fields
    context.set_value('tenant_id', context.req.user.tenantId);
  }
}));
```

---

## Operation Control

### cancel_operation

Cancels the current operation and returns a custom response. This stops all further processing and rolls back any active transaction.

**Signature:** `context.cancel_operation(statusCode, response)`

**Parameters:**
- `statusCode` (number) - HTTP status code (default: 400)
- `response` (Object) - Response body to send

**Returns:** The response object

**Example:**
```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Validate input
    if (context.req.body.price < 0) {
      context.cancel_operation(400, {
        success: false,
        error: 'Price cannot be negative'
      });
      return;
    }
    
    // Check business rules
    const count = await Item.count({ 
      where: { category: context.req.body.category } 
    });
    if (count >= 100) {
      context.cancel_operation(422, {
        success: false,
        error: 'Category limit reached'
      });
      return;
    }
  }
}));
```

**Transaction Rollback:**
```javascript
app.use('/orders', create(Order, {
  post: async (context) => {
    // Even in post hooks, cancel_operation rolls back the transaction
    try {
      await processPayment(context.created);
    } catch (error) {
      context.cancel_operation(402, {
        success: false,
        error: 'Payment failed',
        details: error.message
      });
      return; // Order will be rolled back
    }
  }
}));
```

---

## Additional Properties

### models

Provides access to all Sequelize models registered with the sequelize instance.

**Type:** Object (keyed by model name)

**Example:**
```javascript
app.use('/users', create(User, {
  post: async (context) => {
    // Access other models via context.models
    await context.models.UserProfile.create({
      user_id: context.created.id,
      theme: 'default'
    }, { transaction: context.transaction });
    
    await context.models.AuditLog.create({
      action: 'user_created',
      record_id: context.created.id
    }, { transaction: context.transaction });
  }
}));
```

---

## Helper Availability by Operation

| Helper | create | update | patch | destroy | list | search | single |
|--------|--------|--------|-------|---------|------|--------|--------|
| `apply_where` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `apply_multiple_where` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `apply_where_if_not_exists` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `remove_where` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `replace_where` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `apply_scope` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `apply_scopes` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `set_value` | ✓ | ✓ | ✓ | - | - | - | - |
| `set_multiple_values` | ✓ | ✓ | ✓ | - | - | - | - |
| `remove_value` | ✓ | ✓ | ✓ | - | - | - | - |
| `replace_body` | ✓ | ✓ | ✓ | - | - | - | - |
| `cancel_operation` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Common Patterns

### Multi-Tenant Filtering

```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    // Enforce tenant isolation
    context.apply_where({ tenant_id: context.req.user.tenantId });
  }
}));
```

### Audit Trail

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    context.set_multiple_values({
      created_by: context.req.user.id,
      created_at: new Date()
    });
  }
}));

app.use('/items', patch(Item, {
  pre: async (context) => {
    context.set_multiple_values({
      updated_by: context.req.user.id,
      updated_at: new Date()
    });
  }
}));
```

### Soft Delete Filtering

```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    // Default to showing only non-deleted items
    context.apply_where_if_not_exists({ deleted_at: null });
  }
}));
```

### Input Sanitization

```javascript
app.use('/items', create(Item, {
  pre: async (context) => {
    // Remove fields users shouldn't set
    context.remove_value(['id', 'created_at', 'internal_status']);
    
    // Force certain values
    context.set_value('status', 'pending');
  }
}));
```

### Conditional Logic Based on User Role

```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    if (context.req.user.role === 'admin') {
      // Admins see everything
      return;
    }
    
    // Regular users only see their own items
    context.apply_where({ owner_id: context.req.user.id });
  }
}));
```

---

## See Also

- [Hooks](hooks.md) - Pre and post hook documentation
- [Middleware](middleware.md) - Request middleware (if available)
- [List Operation](list.md) - List operation options
- [Create Operation](create.md) - Create operation options
