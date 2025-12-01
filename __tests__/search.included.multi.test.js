const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search } = require('../src');

async function buildAppAndModels() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Label = sequelize.define(
    'Label',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { tableName: 'labels_search_multi2', timestamps: false }
  );

  const Artist = sequelize.define(
    'Artist',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      label_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'artists_search_multi2', timestamps: false }
  );

  const Album = sequelize.define(
    'Album',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(100), allowNull: false },
      artist_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'albums_search_multi2', timestamps: false }
  );

  Artist.belongsTo(Label, { as: 'label', foreignKey: 'label_id' });
  Label.hasMany(Artist, { as: 'artists', foreignKey: 'label_id' });

  Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
  Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use(
    '/albums',
    search(
      Album,
      {},
      {
        include: [
          {
            model: Artist,
            as: 'artist',
            include: [{ model: Label, as: 'label' }],
          },
        ],
      }
    )
  );

  return { sequelize, Label, Artist, Album, app };
}

async function seed(Label, Artist, Album) {
  const [sony, warner] = await Label.bulkCreate(
    [{ name: 'Sony' }, { name: 'Warner' }],
    { returning: true }
  );
  const [beethoven, prince] = await Artist.bulkCreate(
    [
      { name: 'Ludwig van Beethoven', label_id: sony.id },
      { name: 'Prince', label_id: warner.id },
    ],
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

describe('search: multi-level include filtering', () => {
  let sequelize;
  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('filters by artist.label.name dotted path (case-insensitive equality by default)', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Label, Artist, Album, app } = ctx;
    await seed(Label, Artist, Album);

    // Default equality is case-insensitive (SQLite also treats ASCII as case-insensitive for LIKE)
    const res = await request(app)
      .post('/albums/search')
      .send({
        filtering: { 'artist.label.name': 'warner' },
        ordering: { order_by: 'id', direction: 'ASC' },
      });

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['1999', 'Purple Rain']);
  });
});
