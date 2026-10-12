'use strict';

// The smallest possible mini-express app. Run: node examples/hello-world.js
const express = require('..');

const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/hello/:name', (req, res) => {
  res.json({ greeting: `Hello, ${req.params.name}!`, query: req.query });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Example app listening on http://localhost:${port}`);
});
