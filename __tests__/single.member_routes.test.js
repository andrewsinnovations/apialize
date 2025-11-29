const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create } = require('../src');

async function build({ singleOptions = {}, modelOptions = {} } = {}) {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { tableName: 'member_users', timestamps: false }
  );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());

  app.use('/users', create(User));
  app.use('/users', single(User, singleOptions, modelOptions));

  return { sequelize, User, app };
}

describe('single member_routes', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) await sequelize.close();
    sequelize = null;
  });

  test('GET member route sees loaded record and returns its own payload', async () => {
    const { sequelize: s, app } = await build({
      singleOptions: {
        member_routes: [
          {
            path: 'profile',
            method: 'get',
            async handler(req, _res) {
              // record is normalized, id maps to id_mapping (default 'id')
              return { success: true, userName: req.apialize.record.name };
            },
          },
        ],
      },
    });
    sequelize = s;

    const created = await request(app)
      .post('/users')
      .send({ external_id: 'u1', name: 'Alice' });

    const res = await request(app).get(`/users/${created.body.id}/profile`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, userName: 'Alice' });
  });

  test('POST member route runs after loader and can use rawRecord; returns default payload when undefined', async () => {
    const {
      sequelize: s,
      User,
      app,
    } = await build({
      singleOptions: {
        member_routes: [
          {
            path: 'touch',
            method: 'post',
            async handler(req, res) {
              // Modify using ORM instance then don't return anything
              const inst = req.apialize.rawRecord;
              await inst.update({ name: inst.get('name') + '!' });
              // Intentionally do not send or return
            },
          },
        ],
      },
    });
    sequelize = s;

    const created = await request(app)
      .post('/users')
      .send({ external_id: 'u2', name: 'Bob' });

    const res = await request(app)
      .post(`/users/${created.body.id}/touch`)
      .send({});
    expect(res.status).toBe(200);
    // default single payload should be returned (with updated name)
    expect(res.body.success).toBe(true);
    expect(res.body.record).toMatchObject({
      id: created.body.id,
      name: 'Bob!',
    });

    // Sanity: actually updated in DB
    const db = await User.findByPk(created.body.id);
    expect(db.get('name')).toBe('Bob!');
  });

  test('member route inherits single middleware (can block)', async () => {
    const rejectEven = (req, res, next) => {
      const id = parseInt(req.params.id, 10);
      if (id % 2 === 0) return res.status(403).json({ error: 'Forbidden' });
      next();
    };

    const { sequelize: s, app } = await build({
      singleOptions: {
        middleware: [rejectEven],
        member_routes: [
          {
            path: 'echo',
            method: 'get',
            async handler(req) {
              return { id: req.apialize.record.id };
            },
          },
        ],
      },
    });
    sequelize = s;

    const one = await request(app)
      .post('/users')
      .send({ external_id: 'u3', name: 'C' });
    const two = await request(app)
      .post('/users')
      .send({ external_id: 'u4', name: 'D' });

    const ok = await request(app).get(`/users/${one.body.id}/echo`);
    expect(ok.status).toBe(200);
    const blocked = await request(app).get(
      `/users/${two.body.id + (two.body.id % 2 === 0 ? 0 : 1)}/echo`
    );
    // Ensure we hit an even id for block:
    if (blocked.status !== 403) {
      // If accidentally odd, try even explicitly
      const evenId = one.body.id % 2 === 0 ? one.body.id : one.body.id + 1;
      const b2 = await request(app).get(`/users/${evenId}/echo`);
      expect([403, 404]).toContain(b2.status); // 404 possible if evenId doesn't exist
    } else {
      expect(blocked.status).toBe(403);
    }
  });

  test('404 when record not found before handler', async () => {
    const { sequelize: s, app } = await build({
      singleOptions: {
        member_routes: [
          {
            path: 'profile',
            method: 'get',
            async handler() {
              return { shouldNot: 'reach' };
            },
          },
        ],
      },
    });
    sequelize = s;

    const res = await request(app).get(`/users/999/profile`);
    expect(res.status).toBe(404);
  });

  test('handler may send its own response', async () => {
    const { sequelize: s, app } = await build({
      singleOptions: {
        member_routes: [
          {
            path: 'send',
            method: 'get',
            async handler(_req, res) {
              res.status(202).json({ custom: true });
            },
          },
        ],
      },
    });
    sequelize = s;

    const created = await request(app)
      .post('/users')
      .send({ external_id: 'u5', name: 'E' });

    const res = await request(app).get(`/users/${created.body.id}/send`);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ custom: true });
  });

  test('supports all HTTP verbs for member routes', async () => {
    const {
      sequelize: s,
      User,
      app,
    } = await build({
      singleOptions: {
        member_routes: [
          {
            path: 'get-verb',
            method: 'get',
            async handler(req) {
              return { method: 'GET', id: req.apialize.record.id };
            },
          },
          {
            path: 'post-verb',
            method: 'post',
            async handler(req) {
              return { method: 'POST', body: req.body };
            },
          },
          {
            path: 'put-verb',
            method: 'put',
            async handler(req) {
              const inst = req.apialize.rawRecord;
              await inst.update({ name: 'put' });
              return { method: 'PUT', name: inst.get('name') };
            },
          },
          {
            path: 'patch-verb',
            method: 'patch',
            async handler(req) {
              const inst = req.apialize.rawRecord;
              await inst.update({ name: inst.get('name') + '~' });
              return { method: 'PATCH', name: inst.get('name') };
            },
          },
          {
            path: 'delete-verb',
            method: 'delete',
            async handler(req) {
              await req.apialize.rawRecord.destroy();
              return { method: 'DELETE', deleted: true };
            },
          },
        ],
      },
    });
    sequelize = s;

    const created = await request(app)
      .post('/users')
      .send({ external_id: 'verbs', name: 'VerbUser' });

    const id = created.body.id;

    const g = await request(app).get(`/users/${id}/get-verb`);
    expect(g.status).toBe(200);
    expect(g.body).toEqual({ method: 'GET', id });

    const p = await request(app).post(`/users/${id}/post-verb`).send({ x: 1 });
    expect(p.status).toBe(200);
    expect(p.body).toEqual({ method: 'POST', body: { x: 1 } });

    const put = await request(app).put(`/users/${id}/put-verb`).send({});
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ method: 'PUT', name: 'put' });
    const afterPut = await User.findByPk(id);
    expect(afterPut.get('name')).toBe('put');

    const patch = await request(app).patch(`/users/${id}/patch-verb`).send({});
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ method: 'PATCH', name: 'put~' });
    const afterPatch = await User.findByPk(id);
    expect(afterPatch.get('name')).toBe('put~');

    const del = await request(app).delete(`/users/${id}/delete-verb`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ method: 'DELETE', deleted: true });

    // Subsequent single should 404 because record was deleted
    const notFound = await request(app).get(`/users/${id}`);
    expect(notFound.status).toBe(404);
  });
});
