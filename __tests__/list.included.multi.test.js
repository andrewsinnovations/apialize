const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list } = require('../src');

async function buildAppAndModels() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Label = sequelize.define(
    'Label',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { tableName: 'labels', timestamps: false }
  );

  const Artist = sequelize.define(
    'Artist',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      label_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'artists_multi', timestamps: false }
  );

  const Album = sequelize.define(
    'Album',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
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
  app.use(
    '/albums',
    list(
      Album,
      { metaShowOrdering: true },
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

describe('list: multi-level include filtering and ordering', () => {
  let sequelize;
  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('filter by artist.label.name and order by artist.label.name then artist.name', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
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
});
