const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('included models filtering and ordering for list and search operations', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('basic included model filtering (dotted paths)', () => {
    async function buildAppAndModels() {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });

      const Artist = sequelize.define(
        'Artist',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'artists_included', timestamps: false }
      );

      const Album = sequelize.define(
        'Album',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          title: { type: DataTypes.STRING(100), allowNull: false },
          artist_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'albums_included', timestamps: false }
      );

      Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
      Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());

      // Mount both list and search with include so $artist.name$ can be used via dotted filters
      app.use(
        '/albums',
        list(Album, {}, { include: [{ model: Artist, as: 'artist' }] })
      );
      app.use(
        '/albums',
        search(Album, {}, { include: [{ model: Artist, as: 'artist' }] })
      );

      return { sequelize, Artist, Album, app };
    }

    async function seed(Artist, Album) {
      const [prince, beethoven] = await Artist.bulkCreate(
        [{ name: 'Prince' }, { name: 'Ludwig van Beethoven' }],
        { returning: true }
      );
      await Album.bulkCreate([
        { title: 'Purple Rain', artist_id: prince.id },
        { title: '1999', artist_id: prince.id },
        { title: 'Symphony No. 5', artist_id: beethoven.id },
      ]);
    }

    function titles(res) {
      return res.body.data.map((r) => r.title);
    }

    test('list: filters by included association attribute using dotted path', async () => {
      const ctx = await buildAppAndModels();
      const { Artist, Album, app } = ctx;
      await seed(Artist, Album);

      // Default equality on string is case-insensitive: lower-case query matches 'Prince'
      const res = await request(app).get(
        '/albums?artist.name=prince&api:order_by=id'
      );
      expect(res.status).toBe(200);
      expect(titles(res)).toEqual(['Purple Rain', '1999']);

      // Explicit case-insensitive equality operator also works
      const res2 = await request(app).get(
        '/albums?artist.name:ieq=PRINCE&api:order_by=id'
      );
      expect(res2.status).toBe(200);
      expect(titles(res2)).toEqual(['Purple Rain', '1999']);
    });

    test('search: filters by included association attribute using dotted path', async () => {
      const ctx = await buildAppAndModels();
      const { Artist, Album, app } = ctx;
      await seed(Artist, Album);

      // Equality match on included model attribute
      const res1 = await request(app)
        .post('/albums/search')
        .send({ filtering: { 'artist.name': 'Ludwig van Beethoven' } });

      expect(res1.status).toBe(200);
      expect(titles(res1)).toEqual(['Symphony No. 5']);

      // Case-insensitive contains on included attribute
      const res2 = await request(app)
        .post('/albums/search')
        .send({ filtering: { 'artist.name': { icontains: 'prince' } } });

      expect(res2.status).toBe(200);
      expect(titles(res2)).toEqual(['Purple Rain', '1999']);
    });

    test('consistency: both operations return same results for same filter', async () => {
      const ctx = await buildAppAndModels();
      const { Artist, Album, app } = ctx;
      await seed(Artist, Album);

      // Test with list operation
      const listRes = await request(app).get(
        '/albums?artist.name=prince&api:order_by=id'
      );
      expect(listRes.status).toBe(200);
      const listTitles = titles(listRes);

      // Test with search operation (equivalent filter)
      const searchRes = await request(app)
        .post('/albums/search')
        .send({
          filtering: { 'artist.name': 'prince' },
          ordering: { order_by: 'id' },
        });
      expect(searchRes.status).toBe(200);
      const searchTitles = titles(searchRes);

      // Both should return the same results
      expect(listTitles).toEqual(searchTitles);
      expect(listTitles).toEqual(['Purple Rain', '1999']);
    });
  });

  describe('ordering by included attributes', () => {
    async function buildAppAndModels() {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });

      const Artist = sequelize.define(
        'Artist',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'artists_order', timestamps: false }
      );

      const Album = sequelize.define(
        'Album',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          title: { type: DataTypes.STRING(100), allowNull: false },
          artist_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'albums_order', timestamps: false }
      );

      Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
      Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/albums',
        list(
          Album,
          { metaShowOrdering: true },
          { include: [{ model: Artist, as: 'artist' }] }
        )
      );
      app.use(
        '/albums',
        search(
          Album,
          { metaShowOrdering: true },
          { include: [{ model: Artist, as: 'artist' }] }
        )
      );

      return { sequelize, Artist, Album, app };
    }

    async function seed(Artist, Album) {
      const [beethoven, prince] = await Artist.bulkCreate(
        [{ name: 'Beethoven' }, { name: 'Prince' }],
        { returning: true }
      );
      await Album.bulkCreate([
        { title: 'Symphony No. 5', artist_id: beethoven.id },
        { title: '1999', artist_id: prince.id },
        { title: 'Purple Rain', artist_id: prince.id },
      ]);
    }

    function titles(res) {
      return res.body.data.map((r) => r.title);
    }

    test('list: order by artist.name ASC then title ASC', async () => {
      const ctx = await buildAppAndModels();
      const { Artist, Album, app } = ctx;
      await seed(Artist, Album);

      const res = await request(app).get(
        '/albums?api:order_by=artist.name,title'
      );
      expect(res.status).toBe(200);
      // Beethoven first, then Prince (ordered by title within artist)
      expect(titles(res)).toEqual(['Symphony No. 5', '1999', 'Purple Rain']);
      expect(res.body.meta.ordering).toEqual([
        {
          order_by: 'artist.name',
          direction: 'ASC',
        },
        {
          order_by: 'title',
          direction: 'ASC',
        },
      ]);
    });

    test('search: order by artist.name DESC then title ASC via POST body', async () => {
      const ctx = await buildAppAndModels();
      const { Artist, Album, app } = ctx;
      await seed(Artist, Album);

      const res = await request(app)
        .post('/albums/search')
        .send({
          ordering: [
            { order_by: 'artist.name', direction: 'DESC' },
            { order_by: 'title', direction: 'ASC' },
          ],
        });
      expect(res.status).toBe(200);
      // Prince first (1999, Purple Rain), then Beethoven
      expect(titles(res)).toEqual(['1999', 'Purple Rain', 'Symphony No. 5']);
      expect(res.body.meta.ordering).toEqual([
        {
          order_by: 'artist.name',
          direction: 'DESC',
        },
        {
          order_by: 'title',
          direction: 'ASC',
        },
      ]);
    });

    test('consistency: both operations support ordering by included attributes', async () => {
      const ctx = await buildAppAndModels();
      const { Artist, Album, app } = ctx;
      await seed(Artist, Album);

      // Test with list operation (ASC order)
      const listRes = await request(app).get(
        '/albums?api:order_by=artist.name,title'
      );
      expect(listRes.status).toBe(200);
      const listTitles = titles(listRes);

      // Test with search operation (same ASC order)
      const searchRes = await request(app)
        .post('/albums/search')
        .send({
          ordering: [
            { order_by: 'artist.name', direction: 'ASC' },
            { order_by: 'title', direction: 'ASC' },
          ],
        });
      expect(searchRes.status).toBe(200);
      const searchTitles = titles(searchRes);

      // Both should return the same results
      expect(listTitles).toEqual(searchTitles);
      expect(listTitles).toEqual(['Symphony No. 5', '1999', 'Purple Rain']);

      // Both should show the same ordering metadata
      expect(listRes.body.meta.ordering).toEqual(searchRes.body.meta.ordering);
    });
  });

  describe('multi-level include filtering and ordering', () => {
    async function buildAppAndModels() {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });

      const Label = sequelize.define(
        'Label',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'labels_multi', timestamps: false }
      );

      const Artist = sequelize.define(
        'Artist',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING(100), allowNull: false },
          label_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'artists_multi', timestamps: false }
      );

      const Album = sequelize.define(
        'Album',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          title: { type: DataTypes.STRING(100), allowNull: false },
          artist_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'albums_multi', timestamps: false }
      );

      Artist.belongsTo(Label, { as: 'label', foreignKey: 'label_id' });
      Label.hasMany(Artist, { as: 'artists', foreignKey: 'label_id' });

      Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
      Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());

      const includeConfig = {
        include: [
          {
            model: Artist,
            as: 'artist',
            include: [{ model: Label, as: 'label' }],
          },
        ],
      };

      app.use(
        '/albums',
        list(Album, { metaShowOrdering: true }, includeConfig)
      );
      app.use('/albums', search(Album, {}, includeConfig));

      return { sequelize, Label, Artist, Album, app };
    }

    async function seed(Label, Artist, Album) {
      const [warner, sony] = await Label.bulkCreate(
        [{ name: 'Warner' }, { name: 'Sony' }],
        { returning: true }
      );
      const [prince, beethoven] = await Artist.bulkCreate(
        [
          { name: 'Prince', label_id: warner.id },
          { name: 'Ludwig van Beethoven', label_id: sony.id },
        ],
        { returning: true }
      );
      await Album.bulkCreate([
        { title: '1999', artist_id: prince.id },
        { title: 'Symphony No. 5', artist_id: beethoven.id },
        { title: 'Purple Rain', artist_id: prince.id },
      ]);
    }

    function titles(res) {
      return res.body.data.map((r) => r.title);
    }

    test('list: filter by artist.label.name and order by artist.label.name then artist.name', async () => {
      const ctx = await buildAppAndModels();
      const { Label, Artist, Album, app } = ctx;
      await seed(Label, Artist, Album);

      const res = await request(app).get(
        '/albums?artist.label.name=warner&api:order_by=artist.label.name,artist.name'
      );
      expect(res.status).toBe(200);
      // Only prince albums (label Warner), ordered by label then artist
      expect(titles(res)).toEqual(['1999', 'Purple Rain']);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'artist.label.name', direction: 'ASC' },
        { order_by: 'artist.name', direction: 'ASC' },
      ]);
    });

    test('search: filters by artist.label.name dotted path (case-insensitive equality by default)', async () => {
      const ctx = await buildAppAndModels();
      const { Label, Artist, Album, app } = ctx;
      await seed(Label, Artist, Album);

      // Default equality is case-insensitive
      const res = await request(app)
        .post('/albums/search')
        .send({
          filtering: { 'artist.label.name': 'warner' },
          ordering: { order_by: 'id', direction: 'ASC' },
        });

      expect(res.status).toBe(200);
      expect(titles(res)).toEqual(['1999', 'Purple Rain']);
    });

    test('consistency: both operations handle multi-level dotted paths', async () => {
      const ctx = await buildAppAndModels();
      const { Label, Artist, Album, app } = ctx;
      await seed(Label, Artist, Album);

      // Test with list operation
      const listRes = await request(app).get(
        '/albums?artist.label.name=warner&api:order_by=id'
      );
      expect(listRes.status).toBe(200);
      const listTitles = titles(listRes);

      // Test with search operation (equivalent filter)
      const searchRes = await request(app)
        .post('/albums/search')
        .send({
          filtering: { 'artist.label.name': 'warner' },
          ordering: { order_by: 'id', direction: 'ASC' },
        });
      expect(searchRes.status).toBe(200);
      const searchTitles = titles(searchRes);

      // Both should return the same results
      expect(listTitles).toEqual(searchTitles);
      expect(listTitles).toEqual(['1999', 'Purple Rain']);
    });
  });
});
