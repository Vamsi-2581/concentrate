const express = require('express');

function fallback() {
  return null;
}

function lookup(map) {
  return map.get('key', fallback);
}

function configure(app) {
  app.get('env');
  app.set('view engine', 'ejs');
}

module.exports = { lookup, configure, express };
