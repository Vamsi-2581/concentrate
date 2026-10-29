var path = require('path');
var resolve = path.resolve;

function View(name) { this.name = name; }

View.prototype.lookup = function lookup(name) {
  var loc = resolve('/root', name);
  return this.resolve(loc, name);
};

// Only bound inside its own body: the bare resolve() above is path.resolve.
View.prototype.resolve = function resolve(dir, file) {
  return dir + file;
};

module.exports = View;
