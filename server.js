import { Hono } from 'jsr:@hono/hono';
import { serveStatic } from 'jsr:@hono/hono/deno';
const app = new Hono();

app.use('/*', serveStatic({ root: './public' }));

// データベースの準備
const kv = await Deno.openKv();

async function getNextId() {
  const key = ['counter', 'pokemons'];
  const res = await kv.atomic().sum(key, 1n).commit();
  if (!res.ok) {
    console.error('IDの生成に失敗しました。');
    return null;
  }
  const counter = await kv.get(key);
  return Number(counter.value);
}

/***  リソースの作成 ***/
app.post('/api/pokemons', async (c) => {
  const body = await c.req.parseBody();
  const record = JSON.parse(body['record']);

  const id = await getNextId();
  if (!id) {
    c.status(503);
    return c.json({ error: 'IDの生成に失敗しました。' });
  }
  record['id'] = id;
  record['createdAt'] = new Date().toISOString();

  await kv.set(['pokemons', id], record);

  c.status(201);
  c.header('Location', `/api/pokemons/${id}`);

  return c.json({ path: c.req.path });
});

/*** リソースの取得（レコード単体） ***/
app.get('/api/pokemons/:id', async (c) => {
  const id = Number(c.req.param('id'));

  if (isNaN(id) || !Number.isInteger(id)) {
    c.status(400);
    return c.json({ message: '取得したいポケモンのIDを正しく指定してください。' });
  }

  const pkmn = await kv.get(['pokemons', id]);

  if (pkmn.value) {
    return c.json(pkmn.value);
  } else {
    c.status(404);
    return c.json({ message: `IDが ${id} のポケモンはいませんでした。` });
  }
});

/*** リソースの取得（コレクション） ***/
app.get('/api/pokemons', async (c) => {
  const pkmns = await kv.list({ prefix: ['pokemons'] });

  const pkmnList = await Array.fromAsync(pkmns);
  if (pkmnList.length > 0) {
    return c.json(pkmnList.map((e) => e.value));
  } else {
    c.status(404);
    return c.json({ message: 'pokemonコレクションのデータは1つもありませんでした。' });
  }
});

/*** リソースの更新 ***/
app.put('/api/pokemons/:id', async (c) => {
  const id = Number(c.req.param('id'));

  if (isNaN(id) || !Number.isInteger(id)) {
    c.status(400); // 400 Bad Request
    return c.json({ message: '更新したいポケモンのIDを正しく指定してください。' });
  }

  const pkmns = await kv.list({ prefix: ['pokemons'] });
  let existed = false;
  for await (const pkmn of pkmns) {
    if (pkmn.value.id == id) {
      existed = true;
      break;
    }
  }

  if (existed) {
    const body = await c.req.parseBody();
    const record = JSON.parse(body['record']);

    if (record.id != id) {
      c.status(400); // 400 Bad Request
      return c.json({ message: '更新したいポケモンのIDを正しく指定してください。' });
    }

    await kv.set(['pokemons', id], record);
    c.status(204); // No Content
    return c.body(null);
  } else {
    c.status(404); // 404 Not Found
    return c.json({ message: `IDが ${id} のポケモンはいませんでした。` });
  }
});

/*** リソースの削除 ***/
app.delete('/api/pokemons/:id', async (c) => {
  const id = Number(c.req.param('id'));

  if (isNaN(id) || !Number.isInteger(id)) {
    c.status(400); // 400 Bad Request
    return c.json({ message: '削除したいポケモンのIDを正しく指定してください。' });
  }

  const pkmns = await kv.list({ prefix: ['pokemons'] });
  let existed = false;
  for await (const pkmn of pkmns) {
    if (pkmn.value.id == id) {
      existed = true;
      break;
    }
  }

  if (existed) {
    await kv.delete(['pokemons', id]);
    c.status(204); // 204 No Content
    return c.body(null);
  } else {
    c.status(404);
    return c.json({ message: `IDが ${id} のポケモンはいませんでした。` });
  }
});

/*** リソースをすべて削除（練習用） ***/
app.delete('/api/pokemons', async (c) => {
  const deleteList = await kv.list({ prefix: ['pokemons'] });

  const atomic = kv.atomic();
  for await (const entry of deleteList) atomic.delete(entry.key);
  const result = await atomic.commit();

  if (result.ok) {
    await kv.delete(['counter', 'pokemons']);
    c.status(204);
    return c.body(null);
  } else {
    c.status(503);
    return c.json({ message: 'レコードの一括削除に失敗しました。' });
  }
});

Deno.serve(app.fetch);
