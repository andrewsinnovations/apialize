# Model Configuration

Apialize allows you to configure default behavior directly in your Sequelize model definitions. This approach centralizes configuration and reduces repetitive code across your endpoints. You can set global defaults, operation-specific defaults, and even create multiple named contexts for different use cases.

## Table of Contents

- [Basic Structure](#basic-structure)
- [Configuration Hierarchy](#configuration-hierarchy)
- [Global Default Configuration](#global-default-configuration)
- [Operation-Specific Configuration](#operation-specific-configuration)
- [Named Contexts](#named-contexts)
- [Model Options](#model-options)
- [Configuration Options by Operation](#configuration-options-by-operation)
- [Complete Examples](#complete-examples)

## Basic Structure

Add an `apialize` property to your Sequelize model's options:

```javascript
const Product = sequelize.define(
  'Product',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sku: { type: DataTypes.STRING(50), unique: true },
    name: { type: DataTypes.STRING(100) },
    status: { type: DataTypes.STRING(20) }
  },
  {
    tableName: 'products',
    timestamps: false,
    apialize: {
      // Configuration goes here
    }
  }
);
```

## Configuration Hierarchy

Apialize merges configurations in the following order (later values override earlier ones):

1. **Global default** (`apialize.default`)
2. **Operation-specific default** (`apialize.{operation}.default`)
3. **Named context** (`apialize.{operation}.{context_name}`)
4. **User-provided options** (passed to the operation function)

```javascript
apialize: {
  default: {
    // Applied to ALL operations
    id_mapping: 'sku'
  },
  list: {
    default: {
      // Applied to ALL list operations
      default_page_size: 50
    },
    admin: {
      // Applied only when apialize_context: 'admin' is specified
      default_page_size: 200
    }
  }
}
```

## Global Default Configuration

Settings in `apialize.default` apply to all operations unless overridden:

```javascript
const Product = sequelize.define('Product', { /* ... */ }, {
  apialize: {
    default: {
      id_mapping: 'sku',           // Use 'sku' instead of 'id' for all operations
      middleware: [authMiddleware], // Apply to all operations
      pre: async (context) => {     // Pre-hook for all operations
        console.log('Operation starting');
      },
      post: async (context) => {    // Post-hook for all operations
        console.log('Operation complete');
      }
    }
  }
});

// All operations inherit the global defaults
app.use('/products', crud(Product));
```

## Operation-Specific Configuration

Each operation type (`create`, `update`, `patch`, `destroy`, `list`, `search`, `single`) can have its own defaults:

```javascript
const Product = sequelize.define('Product', { /* ... */ }, {
  apialize: {
    default: {
      id_mapping: 'sku'
    },
    list: {
      default: {
        default_page_size: 50,
        default_order_by: 'name',
        default_order_dir: 'ASC',
        orderable_fields: ['name', 'created_at'],
        filterable_fields: ['status', 'category']
      }
    },
    single: {
      default: {
        param_name: 'sku'  // Use :sku in URL params
      }
    },
    create: {
      default: {
        validate: true,
        allowed_fields: ['name', 'sku', 'status']
      }
    },
    update: {
      default: {
        validate: true,
        allowed_fields: ['name', 'status']
      }
    }
  }
});

app.use('/products', crud(Product));
```

## Named Contexts

Named contexts let you define multiple configurations for the same operation type. This is useful for different user roles, API versions, or specialized endpoints:

```javascript
const Product = sequelize.define('Product', { /* ... */ }, {
  apialize: {
    default: {
      id_mapping: 'sku'
    },
    list: {
      default: {
        // Standard list endpoint
        default_page_size: 20,
        filterable_fields: ['status']
      },
      admin: {
        // Admin list endpoint with more options
        default_page_size: 100,
        filterable_fields: ['status', 'category', 'supplier_id'],
        model_options: {
          scopes: ['withDeleted']  // Include soft-deleted records
        }
      },
      public: {
        // Public API with restrictions
        default_page_size: 10,
        filterable_fields: ['status'],
        model_options: {
          scopes: ['published']  // Only published products
        }
      }
    },
    single: {
      default: {
        param_name: 'sku'
      },
      internal: {
        // Internal API uses database ID
        param_name: 'id',
        id_mapping: 'id'
      }
    }
  }
});

// Mount different contexts on different routes
app.use('/api/products', list(Product));                              // Uses 'default'
app.use('/api/admin/products', list(Product, { apialize_context: 'admin' }));
app.use('/api/public/products', list(Product, { apialize_context: 'public' }));

app.use('/api/products', single(Product));                            // Uses 'default'
app.use('/internal/products', single(Product, { apialize_context: 'internal' }));
```

## Model Options

The `model_options` property allows you to configure Sequelize-specific options like scopes and schemas. These are applied before the operation executes:

```javascript
// Define scopes on your model
Product.addScope('active', {
  where: { status: 'active' }
});

Product.addScope('featured', {
  where: { is_featured: true }
});

const Product = sequelize.define('Product', { /* ... */ }, {
  apialize: {
    list: {
      default: {
        default_page_size: 50
      },
      active: {
        model_options: {
          scopes: ['active']  // Apply the 'active' scope
        }
      },
      featured: {
        model_options: {
          scopes: ['featured', 'active']  // Apply multiple scopes
        }
      }
    },
    single: {
      default: {
        param_name: 'sku'
      },
      activeOnly: {
        param_name: 'sku',
        model_options: {
          scopes: ['active']
        }
      }
    }
  }
});

// Different endpoints with different scopes
app.use('/products', list(Product));                                    // All products
app.use('/products/active', list(Product, { apialize_context: 'active' }));
app.use('/products/featured', list(Product, { apialize_context: 'featured' }));

app.use('/products', single(Product));                                  // Any product
app.use('/products/active', single(Product, { apialize_context: 'activeOnly' }));
```

### Global Model Options

You can also set model options at the global level to apply to all operations:

```javascript
const Product = sequelize.define('Product', { /* ... */ }, {
  apialize: {
    default: {
      id_mapping: 'sku',
      model_options: {
        scopes: ['defaultScope']  // Applied to all operations
      }
    },
    list: {
      admin: {
        model_options: {
          scopes: ['withDeleted']  // Overrides global for admin context
        }
      }
    }
  }
});
```

## Configuration Options by Operation

### All Operations

These options can be set in `default` or any operation:

- `id_mapping` - Field to use instead of `id` (e.g., `'sku'`, `'uuid'`)
- `middleware` - Array of Express middleware functions
- `pre` - Pre-hook function or array of functions
- `post` - Post-hook function or array of functions
- `model_options` - Object with `scopes` and/or `schema`
- `relation_id_mapping` - Map external IDs for related models

### List and Search Operations

- `default_page_size` - Default number of records per page
- `default_order_by` - Default field to order by
- `default_order_dir` - Default order direction (`'ASC'` or `'DESC'`)
- `orderable_fields` - Array of fields that can be used for sorting
- `filterable_fields` - Array of fields that can be filtered
- `meta_show_ordering` - Include ordering info in response metadata
- `meta_show_filtering` - Include filtering info in response metadata

### Single Operation

- `param_name` - URL parameter name (e.g., `'sku'` for `/:sku`)

### Create, Update, Patch Operations

- `validate` - Enable/disable validation
- `allowed_fields` - Array of fields that can be set
- `blocked_fields` - Array of fields that cannot be set

## Complete Examples

### Multi-Tenant Application

```javascript
const Order = sequelize.define('Order', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  order_number: { type: DataTypes.STRING(50), unique: true },
  tenant_id: { type: DataTypes.INTEGER },
  status: { type: DataTypes.STRING(20) },
  total: { type: DataTypes.DECIMAL(10, 2) },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  apialize: {
    default: {
      id_mapping: 'order_number',
      pre: async (context) => {
        // Add tenant filtering to all operations
        const tenantId = context.req.user.tenant_id;
        context.apply_where({ tenant_id: tenantId });
      }
    },
    list: {
      default: {
        default_page_size: 25,
        default_order_by: 'created_at',
        default_order_dir: 'DESC',
        filterable_fields: ['status']
      },
      admin: {
        default_page_size: 100,
        filterable_fields: ['status', 'tenant_id'],  // Admins can filter by tenant
        pre: []  // Override global pre-hook for admins
      }
    },
    create: {
      default: {
        allowed_fields: ['order_number', 'total'],
        pre: async (context) => {
          context.set_multiple_values({
            tenant_id: context.req.user.tenant_id,
            status: 'pending'
          });
        }
      }
    }
  }
});
```

### Public and Admin APIs

```javascript
const Article = sequelize.define('Article', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  slug: { type: DataTypes.STRING(100), unique: true },
  title: { type: DataTypes.STRING(200) },
  status: { type: DataTypes.STRING(20) },
  published_at: { type: DataTypes.DATE }
}, {
  apialize: {
    default: {
      id_mapping: 'slug'
    },
    list: {
      public: {
        default_page_size: 10,
        filterable_fields: ['category'],
        model_options: {
          scopes: ['published']  // Only show published articles
        }
      },
      admin: {
        default_page_size: 50,
        filterable_fields: ['status', 'category', 'author_id'],
        model_options: {
          scopes: []  // Show all articles
        }
      }
    },
    single: {
      public: {
        param_name: 'slug',
        model_options: {
          scopes: ['published']
        }
      },
      admin: {
        param_name: 'slug'
      }
    },
    create: {
      admin: {
        allowed_fields: ['title', 'slug', 'content', 'status'],
        post: async (context) => {
          // Auto-publish if status is 'published'
          if (context.payload.status === 'published') {
            await context.model.update(
              { published_at: new Date() },
              { where: { id: context.payload.id } }
            );
          }
        }
      }
    }
  }
});

// Public API
app.use('/api/articles', list(Article, { apialize_context: 'public' }));
app.use('/api/articles', single(Article, { apialize_context: 'public' }));

// Admin API
app.use('/admin/articles', list(Article, { apialize_context: 'admin' }));
app.use('/admin/articles', single(Article, { apialize_context: 'admin' }));
app.use('/admin/articles', create(Article, { apialize_context: 'admin' }));
```

### Different API Versions

```javascript
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4 },
  username: { type: DataTypes.STRING(50) },
  email: { type: DataTypes.STRING(100) }
}, {
  apialize: {
    single: {
      v1: {
        // v1 API uses username
        id_mapping: 'username',
        param_name: 'username'
      },
      v2: {
        // v2 API uses UUID
        id_mapping: 'uuid',
        param_name: 'uuid'
      }
    },
    list: {
      v1: {
        default_page_size: 20
      },
      v2: {
        default_page_size: 50,
        meta_show_ordering: true
      }
    }
  }
});

// API v1
app.use('/v1/users', list(User, { apialize_context: 'v1' }));
app.use('/v1/users', single(User, { apialize_context: 'v1' }));

// API v2
app.use('/v2/users', list(User, { apialize_context: 'v2' }));
app.use('/v2/users', single(User, { apialize_context: 'v2' }));
```

## Overriding Model Configuration

User-provided options always override model configuration:

```javascript
const Product = sequelize.define('Product', { /* ... */ }, {
  apialize: {
    list: {
      default: {
        default_page_size: 50,
        filterable_fields: ['status']
      }
    }
  }
});

// Override the default page size for this specific endpoint
app.use('/products/large', list(Product, {
  default_page_size: 200  // Overrides model config
}));

// Use model defaults
app.use('/products', list(Product));  // Uses page_size: 50
```

## Best Practices

1. **Use global defaults for common settings**: Place `id_mapping`, common middleware, and shared hooks in `apialize.default`

2. **Create named contexts for different use cases**: Use contexts like `admin`, `public`, `internal` rather than duplicating configuration

3. **Keep operation-specific settings in operation blocks**: Don't put `default_page_size` in global defaults—it only applies to list/search

4. **Leverage model_options for data scoping**: Use Sequelize scopes to filter data rather than custom where clauses

5. **Document your contexts**: Add comments explaining when each context should be used

6. **Combine with relation_id_mapping**: Use model configuration with relation ID mapping for cleaner external APIs

## See Also

- [Hooks](hooks.md) - Detailed information about pre and post hooks
- [Filtering](filtering.md) - How to configure filterable fields
- [Relation ID Mapping](relation_id_mapping.md) - Mapping external IDs for relationships
- [Context Helpers](context_helpers.md) - Helper functions available in hooks
